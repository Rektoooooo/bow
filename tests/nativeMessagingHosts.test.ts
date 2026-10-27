/**
 * WHY this file exists:
 *   Host manifests registered for other browsers are linked into ours at startup. These tests use made-up folders in
 *   a temporary directory: what gets linked, what wins on a name clash, and that only dead links are cleared.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { linkNativeMessagingHosts, listOtherBrowserHostFolders } from "../src/main/nativeMessagingHosts";

let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "native-hosts-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function writeManifest(folder: string, name: string, content = "{}"): void {
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, name), content);
}

describe("linkNativeMessagingHosts", () => {
  it("links the manifests of other browsers into ours, first folder winning a name", () => {
    const arcFolder = path.join(root, "arc");
    const braveFolder = path.join(root, "brave");
    const ourFolder = path.join(root, "ours");
    writeManifest(arcFolder, "com.example.vault.json", '{"from":"arc"}');
    writeManifest(braveFolder, "com.example.vault.json", '{"from":"brave"}');
    writeManifest(braveFolder, "com.example.notes.json");
    writeManifest(braveFolder, "not a manifest.txt");

    const report = linkNativeMessagingHosts([arcFolder, braveFolder, path.join(root, "missing")], ourFolder);

    expect(report.linked.sort()).toEqual(["com.example.notes.json", "com.example.vault.json"]);
    expect(fs.readFileSync(path.join(ourFolder, "com.example.vault.json"), "utf8")).toBe('{"from":"arc"}');
    expect(fs.lstatSync(path.join(ourFolder, "com.example.notes.json")).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(ourFolder, "not a manifest.txt"))).toBe(false);
  });

  it("never replaces a manifest of our own, and links nothing twice", () => {
    const arcFolder = path.join(root, "arc");
    const ourFolder = path.join(root, "ours");
    writeManifest(arcFolder, "com.example.vault.json", '{"from":"arc"}');
    writeManifest(ourFolder, "com.example.vault.json", '{"from":"ours"}');

    expect(linkNativeMessagingHosts([arcFolder], ourFolder).linked).toEqual([]);
    expect(fs.readFileSync(path.join(ourFolder, "com.example.vault.json"), "utf8")).toBe('{"from":"ours"}');
  });

  it("clears links whose manifest is gone, and keeps the rest", () => {
    const arcFolder = path.join(root, "arc");
    const ourFolder = path.join(root, "ours");
    writeManifest(arcFolder, "com.example.vault.json");
    writeManifest(arcFolder, "com.example.notes.json");
    linkNativeMessagingHosts([arcFolder], ourFolder);
    fs.rmSync(path.join(arcFolder, "com.example.notes.json"));

    const report = linkNativeMessagingHosts([arcFolder], ourFolder);

    expect(report.cleared).toEqual(["com.example.notes.json"]);
    expect(fs.existsSync(path.join(ourFolder, "com.example.vault.json"))).toBe(true);
    expect(fs.readdirSync(ourFolder)).toEqual(["com.example.vault.json"]);
  });

  it("knows the other browsers' folders on macOS", () => {
    const folders = listOtherBrowserHostFolders("/Users/someone");
    expect(folders).toContain("/Users/someone/Library/Application Support/Arc/User Data/NativeMessagingHosts");
    expect(folders.some((folder) => folder.includes("Google/Chrome"))).toBe(false);
  });
});
