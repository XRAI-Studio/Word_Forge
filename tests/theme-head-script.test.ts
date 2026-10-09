import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_HEAD_SCRIPT } from "@/lib/theme-head-script";

// SHA-256 of the ts-theme v1 head script, recorded in the portal's docs/class-standard.md
// §6.1. Every copy must be the canonical text, byte for byte.
const CANONICAL_SHA256 = "52ad95b1be229499b0f5cbc300824b4b9584fc27d44683dd353f5d20e3569423";
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("ts-theme v1 head script", () => {
  it("the shell's copy (rendered by the root layout) is the canonical text", () => {
    expect(sha256(THEME_HEAD_SCRIPT)).toBe(CANONICAL_SHA256);
  });

  it("the game page carries the canonical text inline, first in <head> after the metas", () => {
    // A Windows checkout may have CRLF line endings; the script text is the LF form.
    const html = readFileSync("public/index.html", "utf8").replace(/\r\n/g, "\n");
    const scripts = [...html.matchAll(/<script data-ts-theme>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(sha256(scripts[0][1])).toBe(CANONICAL_SHA256);
    const head = html.slice(html.indexOf("<head>") + "<head>".length, html.indexOf("<script data-ts-theme>"));
    expect(head.trim().split("\n")).toEqual([
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    ]);
  });

  it("no stylesheet keys colours off the OS setting (the script resolves Auto)", () => {
    const html = readFileSync("public/index.html", "utf8");
    const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
    expect(styles).not.toContain("prefers-color-scheme");
    expect(styles).toContain(':root[data-theme="dark"]');
  });
});
