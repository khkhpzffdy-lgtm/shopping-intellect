import '@testing-library/jest-dom/vitest';
var createStorage = function () {
    var data = new Map();
    return {
        get length() {
            return data.size;
        },
        clear: function () {
            data = new Map();
        },
        getItem: function (key) {
            var _a;
            return (_a = data.get(key)) !== null && _a !== void 0 ? _a : null;
        },
        key: function (index) {
            var _a;
            return (_a = Array.from(data.keys())[index]) !== null && _a !== void 0 ? _a : null;
        },
        removeItem: function (key) {
            data.delete(key);
        },
        setItem: function (key, value) {
            data.set(key, value);
        }
    };
};
Object.defineProperty(window, 'localStorage', {
    value: createStorage(),
    configurable: true
});
Object.defineProperty(window, 'sessionStorage', {
    value: createStorage(),
    configurable: true
});
