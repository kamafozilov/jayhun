use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelChoice {
    harness: String,
    model: String,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelPreferences {
    choice: Option<ModelChoice>,
    models: BTreeMap<String, String>,
}

pub struct ModelPreferencesStore {
    path: PathBuf,
}

impl ModelPreferencesStore {
    fn connect(&self) -> Result<Connection, String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(&self.path).map_err(|e| e.to_string())?;
        conn.busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS model_preferences (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                value TEXT NOT NULL
            );",
        )
        .map_err(|e| e.to_string())?;
        Ok(conn)
    }

    fn load(&self, mut legacy: ModelPreferences) -> Result<(ModelPreferences, bool), String> {
        let mut conn = self.connect()?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let saved = read_preferences(&tx)?;
        if saved.as_ref().is_some_and(|value| value.choice.is_some()) {
            tx.commit().map_err(|e| e.to_string())?;
            return Ok((saved.unwrap(), false));
        }
        validate_preferences(&legacy)?;
        if let Some(saved) = &saved {
            // Existing per-provider saves win, but do not block migrating a default
            // from an older origin that has not opened the shared store yet.
            legacy.models.extend(saved.models.clone());
        }
        if let Some(choice) = legacy.choice.as_mut() {
            // Older clients stored provider defaults separately from the last choice.
            if let Some(model) = legacy.models.get(&choice.harness) {
                choice.model.clone_from(model);
            }
        }
        let changed = saved.as_ref() != Some(&legacy)
            && (legacy.choice.is_some() || !legacy.models.is_empty());
        if changed {
            write_preferences(&tx, &legacy)?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok((legacy, changed))
    }

    fn save(
        &self,
        harness: String,
        model: String,
        make_default: bool,
    ) -> Result<ModelPreferences, String> {
        validate_harness(&harness)?;
        let mut conn = self.connect()?;
        // Acquire the write lock before reading so independent apps cannot lose patches.
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let mut preferences = read_preferences(&tx)?.unwrap_or_default();
        if make_default
            || preferences
                .choice
                .as_ref()
                .is_some_and(|choice| choice.harness == harness)
        {
            preferences.choice = Some(ModelChoice {
                harness: harness.clone(),
                model: model.clone(),
            });
        }
        preferences.models.insert(harness, model);
        write_preferences(&tx, &preferences)?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(preferences)
    }
}

fn validate_harness(harness: &str) -> Result<(), String> {
    // Keep in sync with HARNESSES in src/lib/session.ts.
    match harness {
        "claude" | "codex" | "cursor" | "grok" | "opencode" | "pi" | "omp" | "fx" => Ok(()),
        _ => Err(format!("Invalid model preference harness: {harness}")),
    }
}

fn validate_preferences(preferences: &ModelPreferences) -> Result<(), String> {
    if let Some(choice) = &preferences.choice {
        validate_harness(&choice.harness)?;
    }
    for harness in preferences.models.keys() {
        validate_harness(harness)?;
    }
    Ok(())
}

fn read_preferences(conn: &Connection) -> Result<Option<ModelPreferences>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM model_preferences WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|raw| {
        let preferences = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        validate_preferences(&preferences)?;
        Ok(preferences)
    })
    .transpose()
}

fn write_preferences(conn: &Connection, preferences: &ModelPreferences) -> Result<(), String> {
    let value = serde_json::to_string(preferences).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO model_preferences (id, value) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET value = excluded.value",
        params![value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn init(app: &AppHandle) -> Result<(), String> {
    // Intentionally not app_data_dir(): dev builds have a different app identifier.
    let path = app
        .path()
        .data_dir()
        .map_err(|e| e.to_string())?
        .join("dev.kamafozilov.jayhun")
        .join("model-preferences.db");
    app.manage(ModelPreferencesStore { path });
    Ok(())
}

fn publish_change(app: &AppHandle) {
    if let Err(error) = app.emit("model-preferences-changed", ()) {
        // The write is already durable; focus reloads recover missed notifications.
        eprintln!("Model preferences saved, but change notification failed: {error}");
    }
}

#[tauri::command(async)]
pub fn model_preferences_load(
    app: AppHandle,
    store: State<'_, ModelPreferencesStore>,
    legacy: ModelPreferences,
) -> Result<ModelPreferences, String> {
    let (preferences, migrated) = store.load(legacy)?;
    if migrated {
        publish_change(&app);
    }
    Ok(preferences)
}

#[tauri::command(async)]
pub fn model_preferences_save(
    app: AppHandle,
    store: State<'_, ModelPreferencesStore>,
    harness: String,
    model: String,
    make_default: bool,
) -> Result<ModelPreferences, String> {
    let preferences = store.save(harness, model, make_default)?;
    publish_change(&app);
    Ok(preferences)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Barrier};

    struct TestStore(ModelPreferencesStore);

    impl TestStore {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir()
                .join(format!(
                    "jayhun-model-preferences-{}-{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                ))
                .join("model-preferences.db");
            Self(ModelPreferencesStore { path })
        }
    }

    impl Drop for TestStore {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(self.0.path.parent().unwrap());
        }
    }

    fn legacy(harness: &str, model: &str) -> ModelPreferences {
        ModelPreferences {
            choice: Some(ModelChoice {
                harness: harness.into(),
                model: model.into(),
            }),
            models: BTreeMap::from([(harness.into(), model.into())]),
        }
    }

    #[test]
    fn saved_choice_survives_reopen_and_stale_legacy() {
        let store = TestStore::new();
        let saved = store.0.save("codex".into(), "".into(), true).unwrap();
        let reopened = ModelPreferencesStore {
            path: store.0.path.clone(),
        };
        let (loaded, migrated) = reopened.load(legacy("cursor", "cursor:old")).unwrap();
        assert_eq!(loaded, saved);
        assert!(!migrated);
    }

    #[test]
    fn legacy_seeds_once_and_uses_provider_default() {
        let store = TestStore::new();
        let mut old = legacy("claude", "claude:old");
        old.models.insert("claude".into(), "claude:new".into());
        let (loaded, migrated) = store.0.load(old).unwrap();
        assert!(migrated);
        assert_eq!(loaded, legacy("claude", "claude:new"));
        let (reloaded, migrated) = store.0.load(legacy("cursor", "cursor:stale")).unwrap();
        assert_eq!(reloaded, loaded);
        assert!(!migrated);
    }

    #[test]
    fn origins_without_choice_do_not_block_later_migration() {
        let store = TestStore::new();
        assert_eq!(
            store.0.load(ModelPreferences::default()).unwrap(),
            (ModelPreferences::default(), false)
        );
        let models_only = ModelPreferences {
            choice: None,
            models: BTreeMap::from([("claude".into(), "claude:old".into())]),
        };
        assert_eq!(
            store.0.load(models_only.clone()).unwrap(),
            (models_only, true)
        );
        let mut expected = legacy("codex", "");
        expected.models.insert("claude".into(), "claude:old".into());
        assert_eq!(store.0.load(expected.clone()).unwrap(), (expected, true));
    }

    #[test]
    fn models_without_a_default_survive_refresh_and_the_first_provider_save() {
        let store = TestStore::new();
        let models_only = ModelPreferences {
            choice: None,
            models: BTreeMap::from([("claude".into(), "claude:saved".into())]),
        };
        store.0.load(models_only.clone()).unwrap();
        let refreshed = store.0.load(ModelPreferences::default()).unwrap().0;
        assert_eq!(refreshed.models, models_only.models);
        let saved = store.0.save("codex".into(), "".into(), true).unwrap();
        assert_eq!(saved.models.get("claude"), Some(&"claude:saved".into()));
    }

    #[test]
    fn provider_model_saves_do_not_block_migrating_a_default_choice() {
        let store = TestStore::new();
        store
            .0
            .save("claude".into(), "claude:new".into(), false)
            .unwrap();
        let (loaded, migrated) = store.0.load(legacy("claude", "claude:old")).unwrap();
        assert!(migrated);
        assert_eq!(loaded, legacy("claude", "claude:new"));
    }

    #[test]
    fn provider_patches_preserve_other_saves_and_update_active_choice() {
        let store = TestStore::new();
        store.0.save("codex".into(), "".into(), true).unwrap();
        store
            .0
            .save("claude".into(), "claude:new".into(), false)
            .unwrap();
        let updated = store
            .0
            .save("codex".into(), "codex:new".into(), false)
            .unwrap();
        assert_eq!(updated.choice, legacy("codex", "codex:new").choice);
        assert_eq!(updated.models["claude"], "claude:new");
        assert_eq!(updated.models["codex"], "codex:new");
        let switched = store
            .0
            .save("claude".into(), "claude:next".into(), true)
            .unwrap();
        assert_eq!(switched.choice, legacy("claude", "claude:next").choice);
        assert_eq!(switched.models["codex"], "codex:new");
    }

    #[test]
    fn independent_concurrent_provider_saves_do_not_lose_updates() {
        let store = TestStore::new();
        store.0.save("codex".into(), "".into(), true).unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let workers: Vec<_> = ["claude", "cursor"]
            .into_iter()
            .map(|harness| {
                let connection = ModelPreferencesStore {
                    path: store.0.path.clone(),
                };
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    connection
                        .save(harness.into(), format!("{harness}:new"), false)
                        .unwrap();
                })
            })
            .collect();
        barrier.wait();
        for worker in workers {
            worker.join().unwrap();
        }
        let (loaded, _) = store.0.load(ModelPreferences::default()).unwrap();
        assert_eq!(loaded.choice, legacy("codex", "").choice);
        assert_eq!(loaded.models["claude"], "claude:new");
        assert_eq!(loaded.models["cursor"], "cursor:new");
        assert_eq!(loaded.models["codex"], "");
    }

    #[test]
    fn failed_write_returns_error_and_keeps_committed_preferences() {
        let store = TestStore::new();
        let saved = store.0.save("codex".into(), "".into(), true).unwrap();
        store
            .0
            .connect()
            .unwrap()
            .execute_batch(
                "CREATE TRIGGER reject_preference_update AFTER UPDATE ON model_preferences
                 BEGIN SELECT RAISE(ABORT, 'write rejected'); END;",
            )
            .unwrap();
        let error = store
            .0
            .save("cursor".into(), "cursor:new".into(), true)
            .unwrap_err();
        assert!(error.contains("write rejected"));
        assert_eq!(
            store.0.load(legacy("claude", "claude:stale")).unwrap(),
            (saved, false)
        );
    }

    #[test]
    fn invalid_provider_and_corrupt_storage_return_errors_without_reseeding() {
        let store = TestStore::new();
        assert!(store.0.save("unknown".into(), "".into(), true).is_err());
        assert!(store.0.load(legacy("unknown", "")).is_err());
        let saved = store.0.save("codex".into(), "".into(), true).unwrap();
        assert!(store.0.save("unknown".into(), "".into(), true).is_err());
        assert_eq!(
            store.0.load(ModelPreferences::default()).unwrap(),
            (saved, false)
        );
        store
            .0
            .connect()
            .unwrap()
            .execute("UPDATE model_preferences SET value = 'invalid json'", [])
            .unwrap();
        assert!(store.0.load(legacy("cursor", "cursor:new")).is_err());
        assert!(store.0.save("claude".into(), "".into(), true).is_err());
    }

    #[test]
    fn invalid_preference_shapes_are_rejected() {
        for invalid in [
            r#"{"choice":null,"models":{"codex":1}}"#,
            r#"{"choice":{"harness":"codex","model":null},"models":{}}"#,
            r#"{"choice":null,"models":[]}"#,
            r#"{"choice":null,"models":{},"extra":true}"#,
        ] {
            assert!(serde_json::from_str::<ModelPreferences>(invalid).is_err());
        }
    }
}
