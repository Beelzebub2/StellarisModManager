const test = require("node:test");
const assert = require("node:assert/strict");

const remoteAsset = require("../dist/main/services/remoteAsset.js");

test("thumbnail downloads only accept public http and https urls", () => {
    assert.equal(typeof remoteAsset.normalizeRemoteAssetUrlForTest, "function");

    assert.equal(
        remoteAsset.normalizeRemoteAssetUrlForTest(" https://cdn.cloudflare.steamstatic.com/steam/apps/281990/header.jpg "),
        "https://cdn.cloudflare.steamstatic.com/steam/apps/281990/header.jpg"
    );
    assert.equal(remoteAsset.normalizeRemoteAssetUrlForTest("javascript:alert(1)"), null);
    assert.equal(remoteAsset.normalizeRemoteAssetUrlForTest("file:///tmp/test.jpg"), null);
    assert.equal(remoteAsset.normalizeRemoteAssetUrlForTest("http://127.0.0.1/test.jpg"), null);
    assert.equal(remoteAsset.normalizeRemoteAssetUrlForTest("http://localhost/test.jpg"), null);
    assert.equal(remoteAsset.normalizeRemoteAssetUrlForTest("https://192.168.0.20/test.jpg"), null);
    assert.equal(remoteAsset.normalizeRemoteAssetUrlForTest("https://[::1]/test.jpg"), null);
});

test("thumbnail body reader stops once the configured byte limit is exceeded", async () => {
    assert.equal(typeof remoteAsset.readResponseBufferWithinLimitForTest, "function");

    const allowed = await remoteAsset.readResponseBufferWithinLimitForTest(
        new Response("small-body", {
            headers: {
                "content-length": "10"
            }
        }),
        32
    );
    assert.equal(allowed?.toString("utf8"), "small-body");

    const rejectedByHeader = await remoteAsset.readResponseBufferWithinLimitForTest(
        new Response("large-body", {
            headers: {
                "content-length": "4096"
            }
        }),
        128
    );
    assert.equal(rejectedByHeader, null);

    const rejectedByStream = await remoteAsset.readResponseBufferWithinLimitForTest(
        new Response("abcdef"),
        4
    );
    assert.equal(rejectedByStream, null);
});
