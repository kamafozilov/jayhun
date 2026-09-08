import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { version } from "../../package.json";
import { WhatsNewBody } from "./WhatsNewDialog";

describe("WhatsNewBody", () => {
  it("renders the version notes without the changelog heading", () => {
    const markup = renderToStaticMarkup(
      createElement(WhatsNewBody, { version }),
    );

    expect(markup).toContain("whats-new-md");
    expect(markup).toContain(`What&#x27;s new in Jayhun ${version}`);
    expect(markup).not.toContain(`## [${version}]`);
  });
});
