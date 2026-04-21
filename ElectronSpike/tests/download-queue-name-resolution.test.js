const test = require("node:test");
const assert = require("node:assert/strict");

const downloadManager = require("../dist/main/services/downloadManager.js");

test("queue name resolution fetches the Steam title when only a workshop id is available", async () => {
    assert.equal(typeof downloadManager.resolveQueueModNameForTest, "function");

    const originalFetch = global.fetch;
    const fetchCalls = [];

    global.fetch = async (url, options = {}) => {
        fetchCalls.push({ url, options });
        assert.match(String(url), /GetPublishedFileDetails/);
        assert.equal(options.method, "POST");

        return {
            ok: true,
            async json() {
                return {
                    response: {
                        publishedfiledetails: [
                            {
                                publishedfileid: "123456",
                                title: "Galactic Horizons"
                            }
                        ]
                    }
                };
            }
        };
    };

    try {
        const resolvedName = await downloadManager.resolveQueueModNameForTest("123456", "123456");

        assert.equal(resolvedName, "Galactic Horizons");
        assert.equal(fetchCalls.length, 1);
    } finally {
        global.fetch = originalFetch;
    }
});

test("queue name resolution preserves a descriptive caller-provided name", async () => {
    assert.equal(typeof downloadManager.resolveQueueModNameForTest, "function");

    const originalFetch = global.fetch;
    let fetchCalled = false;

    global.fetch = async () => {
        fetchCalled = true;
        throw new Error("fetch should not be called when the mod name is already descriptive");
    };

    try {
        const resolvedName = await downloadManager.resolveQueueModNameForTest("123456", "Galactic Horizons");

        assert.equal(resolvedName, "Galactic Horizons");
        assert.equal(fetchCalled, false);
    } finally {
        global.fetch = originalFetch;
    }
});
