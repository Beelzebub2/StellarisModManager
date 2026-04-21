const test = require("node:test");
const assert = require("node:assert/strict");

const promptInputBehavior = require("../src/renderer/promptInputBehavior.js");

test("focuses and selects the full default prompt value", () => {
    assert.equal(typeof promptInputBehavior.focusAndSelectPromptInput, "function");

    const calls = [];
    const input = {
        value: "New Profile",
        focus() {
            calls.push("focus");
        },
        select() {
            calls.push("select");
        },
        setSelectionRange(start, end) {
            calls.push(["range", start, end]);
        }
    };

    promptInputBehavior.focusAndSelectPromptInput(input);

    assert.deepEqual(calls, [
        "focus",
        "select",
        ["range", 0, "New Profile".length]
    ]);
});

test("does not try to select text when the prompt input is empty", () => {
    assert.equal(typeof promptInputBehavior.focusAndSelectPromptInput, "function");

    const calls = [];
    const input = {
        value: "",
        focus() {
            calls.push("focus");
        },
        select() {
            calls.push("select");
        },
        setSelectionRange(start, end) {
            calls.push(["range", start, end]);
        }
    };

    promptInputBehavior.focusAndSelectPromptInput(input);

    assert.deepEqual(calls, ["focus"]);
});
