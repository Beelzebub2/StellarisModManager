(function (root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.promptInputBehavior = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function focusAndSelectPromptInput(input) {
        if (!input || typeof input.focus !== "function") {
            return;
        }

        input.focus();

        const value = String(input.value || "");
        if (!value) {
            return;
        }

        if (typeof input.select === "function") {
            input.select();
        }

        if (typeof input.setSelectionRange === "function") {
            input.setSelectionRange(0, value.length);
        }
    }

    return {
        focusAndSelectPromptInput
    };
});
