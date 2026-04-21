const test = require("node:test");
const assert = require("node:assert/strict");

const library = require("../dist/main/services/library.js");

test("legacy local shared ids are treated as unpublished when choosing remote publish mode", () => {
    assert.equal(typeof library.getSharedProfilePublishTarget, "function");

    assert.deepEqual(library.getSharedProfilePublishTarget(""), {
        shouldCreate: true,
        sharedProfileId: null
    });

    assert.deepEqual(library.getSharedProfilePublishTarget("sp-m8qk8w-h4m2zs"), {
        shouldCreate: true,
        sharedProfileId: null
    });

    assert.deepEqual(
        library.getSharedProfilePublishTarget("1234567890abcdef1234567890abcdef"),
        {
            shouldCreate: false,
            sharedProfileId: "1234567890abcdef1234567890abcdef"
        }
    );
});
