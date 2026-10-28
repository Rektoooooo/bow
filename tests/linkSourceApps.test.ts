/**
 * WHY this file exists:
 *   Air Traffic Control reads which app sent a link, and which apps are running, from lsappinfo's text. These made-up
 *   outputs (in its real shape) pin down what is read: the name and bundle id, regular apps only, never Bow itself.
 */
import { describe, expect, it } from "vitest";
import { parseAppInfo, parseRunningApps } from "../src/main/linkSourceApps";

const FRONT_APP_INFO = `"Example Chat" ASN:0x0-0x1234: (in front)
    bundleID="com.example.chat"
    bundle path=[ NULL ]
    pid = 4321 type="Foreground"`;

const RUNNING_APPS = ` 1) "loginwindow" ASN:0x0-0x1001:
    bundleID="com.apple.loginwindow"
    pid = 100 type="UIElement" flavor=3
 2) "Example Mail" ASN:0x0-0x2002:
    bundleID="com.example.mail"
    pid = 200 type="Foreground" flavor=3
 3) "Example Chat" ASN:0x0-0x3003:
    bundleID="com.example.chat"
    pid = 300 type="Foreground" flavor=3
 4) "helperd" ASN:0x0-0x4004:
    bundleID=[ NULL ]
    pid = 400 type="BackgroundOnly"
 5) "Bow" ASN:0x0-0x5005:
    bundleID="io.example.bow"
    pid = 500 type="Foreground"
 6) "Example Chat" ASN:0x0-0x6006:
    bundleID="com.example.chat"
    pid = 600 type="Foreground"`;

describe("link source apps", () => {
  it("read the front app's name and bundle id", () => {
    expect(parseAppInfo(FRONT_APP_INFO)).toEqual({ bundleId: "com.example.chat", name: "Example Chat" });
    expect(parseAppInfo('[ NULL ] ASN:0x0-0x1: \n    bundleID="com.example.chat"')).toBeNull();
    expect(parseAppInfo('"Odd" ASN:0x0-0x1:\n    bundleID="bad id; rm -rf"')).toBeNull();
  });

  it("list regular running apps by name, each once, without Bow itself", () => {
    expect(parseRunningApps(RUNNING_APPS, 500)).toEqual([
      { bundleId: "com.example.chat", name: "Example Chat" },
      { bundleId: "com.example.mail", name: "Example Mail" },
    ]);
  });
});
