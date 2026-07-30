import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GraphAILogger } from "graphai";

import { composeMulmoErrorMessage, describeMulmoCause, enableGraphAIErrorCapture, withMulmoErrorCapture } from "../src/server/mulmoErrorCapture";

describe("describeMulmoCause", () => {
  it("returns null for non-Error values", () => {
    assert.equal(describeMulmoCause("boom"), null);
  });

  it("returns null for an Error without a record cause", () => {
    assert.equal(describeMulmoCause(new Error("boom")), null);
    assert.equal(describeMulmoCause(new Error("boom", { cause: "raw" })), null);
  });

  it("renders known string fields from mulmocast's structured cause", () => {
    const err = new Error("generate error", {
      cause: { type: "apiKeyMissing", agentName: "imageOpenaiAgent", envVarName: "OPENAI_API_KEY", beatIndex: 3 },
    });
    assert.equal(describeMulmoCause(err), "type=apiKeyMissing agentName=imageOpenaiAgent envVarName=OPENAI_API_KEY");
  });

  it("returns null when no known field is a non-empty string", () => {
    assert.equal(describeMulmoCause(new Error("x", { cause: { beatIndex: 1, type: "" } })), null);
  });
});

describe("composeMulmoErrorMessage", () => {
  it("returns the base message when nothing else is available", () => {
    assert.equal(composeMulmoErrorMessage(new Error("generate error"), []), "generate error");
  });

  it("appends cause fields and captured provider errors", () => {
    const err = new Error("generate error: key=sketch_title", { cause: { type: "apiError", agentName: "imageOpenaiAgent" } });
    const message = composeMulmoErrorMessage(err, ["401 Incorrect API key provided"]);
    assert.equal(message, "generate error: key=sketch_title — type=apiError agentName=imageOpenaiAgent — 401 Incorrect API key provided");
  });

  it("dedupes captured messages and drops empties and base duplicates", () => {
    const message = composeMulmoErrorMessage(new Error("boom"), ["boom", "", "quota exceeded", "quota exceeded"]);
    assert.equal(message, "boom — quota exceeded");
  });
});

describe("withMulmoErrorCapture", () => {
  it("passes through the result on success", async () => {
    assert.equal(await withMulmoErrorCapture(async () => 42), 42);
  });

  it("rethrows with the captured GraphAI error appended and the original as cause", async () => {
    enableGraphAIErrorCapture();
    const original = new Error("generateReferenceImage: generate error: key=sketch_title");
    await assert.rejects(
      withMulmoErrorCapture(async () => {
        GraphAILogger.error(new Error("401 Incorrect API key provided"));
        throw original;
      }),
      (err: Error) => {
        assert.equal(err.message, "generateReferenceImage: generate error: key=sketch_title — 401 Incorrect API key provided");
        assert.equal(err.cause, original);
        return true;
      },
    );
  });

  it("does not cross-attribute errors between concurrent operations", async () => {
    enableGraphAIErrorCapture();
    const run = (label: string) =>
      withMulmoErrorCapture(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        GraphAILogger.error(`provider failure ${label}`);
        await new Promise((resolve) => setImmediate(resolve));
        throw new Error(`generate error ${label}`);
      }).catch((err: Error) => err.message);
    const [first, second] = await Promise.all([run("A"), run("B")]);
    assert.equal(first, "generate error A — provider failure A");
    assert.equal(second, "generate error B — provider failure B");
  });
});
