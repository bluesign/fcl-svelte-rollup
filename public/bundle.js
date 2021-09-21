var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }
    function custom_event(type, detail, bubbles = false) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, bubbles, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : options.context || []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.42.6' }, detail), true));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function prop_dev(node, property, value) {
        node[property] = value;
        dispatch_dev('SvelteDOMSetProperty', { node, property, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.wholeText === data)
            return;
        dispatch_dev('SvelteDOMSetData', { node: text, data });
        text.data = data;
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    var global$1 = (typeof global !== "undefined" ? global :
                typeof self !== "undefined" ? self :
                typeof window !== "undefined" ? window : {});

    var lookup = [];
    var revLookup = [];
    var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array;
    var inited = false;
    function init$1 () {
      inited = true;
      var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      for (var i = 0, len = code.length; i < len; ++i) {
        lookup[i] = code[i];
        revLookup[code.charCodeAt(i)] = i;
      }

      revLookup['-'.charCodeAt(0)] = 62;
      revLookup['_'.charCodeAt(0)] = 63;
    }

    function toByteArray (b64) {
      if (!inited) {
        init$1();
      }
      var i, j, l, tmp, placeHolders, arr;
      var len = b64.length;

      if (len % 4 > 0) {
        throw new Error('Invalid string. Length must be a multiple of 4')
      }

      // the number of equal signs (place holders)
      // if there are two placeholders, than the two characters before it
      // represent one byte
      // if there is only one, then the three characters before it represent 2 bytes
      // this is just a cheap hack to not do indexOf twice
      placeHolders = b64[len - 2] === '=' ? 2 : b64[len - 1] === '=' ? 1 : 0;

      // base64 is 4/3 + up to two characters of the original data
      arr = new Arr(len * 3 / 4 - placeHolders);

      // if there are placeholders, only get up to the last complete 4 chars
      l = placeHolders > 0 ? len - 4 : len;

      var L = 0;

      for (i = 0, j = 0; i < l; i += 4, j += 3) {
        tmp = (revLookup[b64.charCodeAt(i)] << 18) | (revLookup[b64.charCodeAt(i + 1)] << 12) | (revLookup[b64.charCodeAt(i + 2)] << 6) | revLookup[b64.charCodeAt(i + 3)];
        arr[L++] = (tmp >> 16) & 0xFF;
        arr[L++] = (tmp >> 8) & 0xFF;
        arr[L++] = tmp & 0xFF;
      }

      if (placeHolders === 2) {
        tmp = (revLookup[b64.charCodeAt(i)] << 2) | (revLookup[b64.charCodeAt(i + 1)] >> 4);
        arr[L++] = tmp & 0xFF;
      } else if (placeHolders === 1) {
        tmp = (revLookup[b64.charCodeAt(i)] << 10) | (revLookup[b64.charCodeAt(i + 1)] << 4) | (revLookup[b64.charCodeAt(i + 2)] >> 2);
        arr[L++] = (tmp >> 8) & 0xFF;
        arr[L++] = tmp & 0xFF;
      }

      return arr
    }

    function tripletToBase64 (num) {
      return lookup[num >> 18 & 0x3F] + lookup[num >> 12 & 0x3F] + lookup[num >> 6 & 0x3F] + lookup[num & 0x3F]
    }

    function encodeChunk (uint8, start, end) {
      var tmp;
      var output = [];
      for (var i = start; i < end; i += 3) {
        tmp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2]);
        output.push(tripletToBase64(tmp));
      }
      return output.join('')
    }

    function fromByteArray (uint8) {
      if (!inited) {
        init$1();
      }
      var tmp;
      var len = uint8.length;
      var extraBytes = len % 3; // if we have 1 byte left, pad 2 bytes
      var output = '';
      var parts = [];
      var maxChunkLength = 16383; // must be multiple of 3

      // go through the array every three bytes, we'll deal with trailing stuff later
      for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
        parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)));
      }

      // pad the end with zeros, but make sure to not forget the extra bytes
      if (extraBytes === 1) {
        tmp = uint8[len - 1];
        output += lookup[tmp >> 2];
        output += lookup[(tmp << 4) & 0x3F];
        output += '==';
      } else if (extraBytes === 2) {
        tmp = (uint8[len - 2] << 8) + (uint8[len - 1]);
        output += lookup[tmp >> 10];
        output += lookup[(tmp >> 4) & 0x3F];
        output += lookup[(tmp << 2) & 0x3F];
        output += '=';
      }

      parts.push(output);

      return parts.join('')
    }

    function read (buffer, offset, isLE, mLen, nBytes) {
      var e, m;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var nBits = -7;
      var i = isLE ? (nBytes - 1) : 0;
      var d = isLE ? -1 : 1;
      var s = buffer[offset + i];

      i += d;

      e = s & ((1 << (-nBits)) - 1);
      s >>= (-nBits);
      nBits += eLen;
      for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

      m = e & ((1 << (-nBits)) - 1);
      e >>= (-nBits);
      nBits += mLen;
      for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

      if (e === 0) {
        e = 1 - eBias;
      } else if (e === eMax) {
        return m ? NaN : ((s ? -1 : 1) * Infinity)
      } else {
        m = m + Math.pow(2, mLen);
        e = e - eBias;
      }
      return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
    }

    function write (buffer, value, offset, isLE, mLen, nBytes) {
      var e, m, c;
      var eLen = nBytes * 8 - mLen - 1;
      var eMax = (1 << eLen) - 1;
      var eBias = eMax >> 1;
      var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0);
      var i = isLE ? 0 : (nBytes - 1);
      var d = isLE ? 1 : -1;
      var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

      value = Math.abs(value);

      if (isNaN(value) || value === Infinity) {
        m = isNaN(value) ? 1 : 0;
        e = eMax;
      } else {
        e = Math.floor(Math.log(value) / Math.LN2);
        if (value * (c = Math.pow(2, -e)) < 1) {
          e--;
          c *= 2;
        }
        if (e + eBias >= 1) {
          value += rt / c;
        } else {
          value += rt * Math.pow(2, 1 - eBias);
        }
        if (value * c >= 2) {
          e++;
          c /= 2;
        }

        if (e + eBias >= eMax) {
          m = 0;
          e = eMax;
        } else if (e + eBias >= 1) {
          m = (value * c - 1) * Math.pow(2, mLen);
          e = e + eBias;
        } else {
          m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
          e = 0;
        }
      }

      for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

      e = (e << mLen) | m;
      eLen += mLen;
      for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

      buffer[offset + i - d] |= s * 128;
    }

    var toString = {}.toString;

    var isArray = Array.isArray || function (arr) {
      return toString.call(arr) == '[object Array]';
    };

    var INSPECT_MAX_BYTES = 50;

    /**
     * If `Buffer.TYPED_ARRAY_SUPPORT`:
     *   === true    Use Uint8Array implementation (fastest)
     *   === false   Use Object implementation (most compatible, even IE6)
     *
     * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
     * Opera 11.6+, iOS 4.2+.
     *
     * Due to various browser bugs, sometimes the Object implementation will be used even
     * when the browser supports typed arrays.
     *
     * Note:
     *
     *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
     *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
     *
     *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
     *
     *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
     *     incorrect length in some situations.

     * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
     * get the Object implementation, which is slower but behaves correctly.
     */
    Buffer.TYPED_ARRAY_SUPPORT = global$1.TYPED_ARRAY_SUPPORT !== undefined
      ? global$1.TYPED_ARRAY_SUPPORT
      : true;

    function kMaxLength () {
      return Buffer.TYPED_ARRAY_SUPPORT
        ? 0x7fffffff
        : 0x3fffffff
    }

    function createBuffer (that, length) {
      if (kMaxLength() < length) {
        throw new RangeError('Invalid typed array length')
      }
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        // Return an augmented `Uint8Array` instance, for best performance
        that = new Uint8Array(length);
        that.__proto__ = Buffer.prototype;
      } else {
        // Fallback: Return an object instance of the Buffer class
        if (that === null) {
          that = new Buffer(length);
        }
        that.length = length;
      }

      return that
    }

    /**
     * The Buffer constructor returns instances of `Uint8Array` that have their
     * prototype changed to `Buffer.prototype`. Furthermore, `Buffer` is a subclass of
     * `Uint8Array`, so the returned instances will have all the node `Buffer` methods
     * and the `Uint8Array` methods. Square bracket notation works as expected -- it
     * returns a single octet.
     *
     * The `Uint8Array` prototype remains unmodified.
     */

    function Buffer (arg, encodingOrOffset, length) {
      if (!Buffer.TYPED_ARRAY_SUPPORT && !(this instanceof Buffer)) {
        return new Buffer(arg, encodingOrOffset, length)
      }

      // Common case.
      if (typeof arg === 'number') {
        if (typeof encodingOrOffset === 'string') {
          throw new Error(
            'If encoding is specified then the first argument must be a string'
          )
        }
        return allocUnsafe(this, arg)
      }
      return from(this, arg, encodingOrOffset, length)
    }

    Buffer.poolSize = 8192; // not used by this implementation

    // TODO: Legacy, not needed anymore. Remove in next major version.
    Buffer._augment = function (arr) {
      arr.__proto__ = Buffer.prototype;
      return arr
    };

    function from (that, value, encodingOrOffset, length) {
      if (typeof value === 'number') {
        throw new TypeError('"value" argument must not be a number')
      }

      if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
        return fromArrayBuffer(that, value, encodingOrOffset, length)
      }

      if (typeof value === 'string') {
        return fromString(that, value, encodingOrOffset)
      }

      return fromObject(that, value)
    }

    /**
     * Functionally equivalent to Buffer(arg, encoding) but throws a TypeError
     * if value is a number.
     * Buffer.from(str[, encoding])
     * Buffer.from(array)
     * Buffer.from(buffer)
     * Buffer.from(arrayBuffer[, byteOffset[, length]])
     **/
    Buffer.from = function (value, encodingOrOffset, length) {
      return from(null, value, encodingOrOffset, length)
    };

    if (Buffer.TYPED_ARRAY_SUPPORT) {
      Buffer.prototype.__proto__ = Uint8Array.prototype;
      Buffer.__proto__ = Uint8Array;
    }

    function assertSize (size) {
      if (typeof size !== 'number') {
        throw new TypeError('"size" argument must be a number')
      } else if (size < 0) {
        throw new RangeError('"size" argument must not be negative')
      }
    }

    function alloc (that, size, fill, encoding) {
      assertSize(size);
      if (size <= 0) {
        return createBuffer(that, size)
      }
      if (fill !== undefined) {
        // Only pay attention to encoding if it's a string. This
        // prevents accidentally sending in a number that would
        // be interpretted as a start offset.
        return typeof encoding === 'string'
          ? createBuffer(that, size).fill(fill, encoding)
          : createBuffer(that, size).fill(fill)
      }
      return createBuffer(that, size)
    }

    /**
     * Creates a new filled Buffer instance.
     * alloc(size[, fill[, encoding]])
     **/
    Buffer.alloc = function (size, fill, encoding) {
      return alloc(null, size, fill, encoding)
    };

    function allocUnsafe (that, size) {
      assertSize(size);
      that = createBuffer(that, size < 0 ? 0 : checked(size) | 0);
      if (!Buffer.TYPED_ARRAY_SUPPORT) {
        for (var i = 0; i < size; ++i) {
          that[i] = 0;
        }
      }
      return that
    }

    /**
     * Equivalent to Buffer(num), by default creates a non-zero-filled Buffer instance.
     * */
    Buffer.allocUnsafe = function (size) {
      return allocUnsafe(null, size)
    };
    /**
     * Equivalent to SlowBuffer(num), by default creates a non-zero-filled Buffer instance.
     */
    Buffer.allocUnsafeSlow = function (size) {
      return allocUnsafe(null, size)
    };

    function fromString (that, string, encoding) {
      if (typeof encoding !== 'string' || encoding === '') {
        encoding = 'utf8';
      }

      if (!Buffer.isEncoding(encoding)) {
        throw new TypeError('"encoding" must be a valid string encoding')
      }

      var length = byteLength(string, encoding) | 0;
      that = createBuffer(that, length);

      var actual = that.write(string, encoding);

      if (actual !== length) {
        // Writing a hex string, for example, that contains invalid characters will
        // cause everything after the first invalid character to be ignored. (e.g.
        // 'abxxcd' will be treated as 'ab')
        that = that.slice(0, actual);
      }

      return that
    }

    function fromArrayLike (that, array) {
      var length = array.length < 0 ? 0 : checked(array.length) | 0;
      that = createBuffer(that, length);
      for (var i = 0; i < length; i += 1) {
        that[i] = array[i] & 255;
      }
      return that
    }

    function fromArrayBuffer (that, array, byteOffset, length) {
      array.byteLength; // this throws if `array` is not a valid ArrayBuffer

      if (byteOffset < 0 || array.byteLength < byteOffset) {
        throw new RangeError('\'offset\' is out of bounds')
      }

      if (array.byteLength < byteOffset + (length || 0)) {
        throw new RangeError('\'length\' is out of bounds')
      }

      if (byteOffset === undefined && length === undefined) {
        array = new Uint8Array(array);
      } else if (length === undefined) {
        array = new Uint8Array(array, byteOffset);
      } else {
        array = new Uint8Array(array, byteOffset, length);
      }

      if (Buffer.TYPED_ARRAY_SUPPORT) {
        // Return an augmented `Uint8Array` instance, for best performance
        that = array;
        that.__proto__ = Buffer.prototype;
      } else {
        // Fallback: Return an object instance of the Buffer class
        that = fromArrayLike(that, array);
      }
      return that
    }

    function fromObject (that, obj) {
      if (internalIsBuffer(obj)) {
        var len = checked(obj.length) | 0;
        that = createBuffer(that, len);

        if (that.length === 0) {
          return that
        }

        obj.copy(that, 0, 0, len);
        return that
      }

      if (obj) {
        if ((typeof ArrayBuffer !== 'undefined' &&
            obj.buffer instanceof ArrayBuffer) || 'length' in obj) {
          if (typeof obj.length !== 'number' || isnan(obj.length)) {
            return createBuffer(that, 0)
          }
          return fromArrayLike(that, obj)
        }

        if (obj.type === 'Buffer' && isArray(obj.data)) {
          return fromArrayLike(that, obj.data)
        }
      }

      throw new TypeError('First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.')
    }

    function checked (length) {
      // Note: cannot use `length < kMaxLength()` here because that fails when
      // length is NaN (which is otherwise coerced to zero.)
      if (length >= kMaxLength()) {
        throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                             'size: 0x' + kMaxLength().toString(16) + ' bytes')
      }
      return length | 0
    }
    Buffer.isBuffer = isBuffer;
    function internalIsBuffer (b) {
      return !!(b != null && b._isBuffer)
    }

    Buffer.compare = function compare (a, b) {
      if (!internalIsBuffer(a) || !internalIsBuffer(b)) {
        throw new TypeError('Arguments must be Buffers')
      }

      if (a === b) return 0

      var x = a.length;
      var y = b.length;

      for (var i = 0, len = Math.min(x, y); i < len; ++i) {
        if (a[i] !== b[i]) {
          x = a[i];
          y = b[i];
          break
        }
      }

      if (x < y) return -1
      if (y < x) return 1
      return 0
    };

    Buffer.isEncoding = function isEncoding (encoding) {
      switch (String(encoding).toLowerCase()) {
        case 'hex':
        case 'utf8':
        case 'utf-8':
        case 'ascii':
        case 'latin1':
        case 'binary':
        case 'base64':
        case 'ucs2':
        case 'ucs-2':
        case 'utf16le':
        case 'utf-16le':
          return true
        default:
          return false
      }
    };

    Buffer.concat = function concat (list, length) {
      if (!isArray(list)) {
        throw new TypeError('"list" argument must be an Array of Buffers')
      }

      if (list.length === 0) {
        return Buffer.alloc(0)
      }

      var i;
      if (length === undefined) {
        length = 0;
        for (i = 0; i < list.length; ++i) {
          length += list[i].length;
        }
      }

      var buffer = Buffer.allocUnsafe(length);
      var pos = 0;
      for (i = 0; i < list.length; ++i) {
        var buf = list[i];
        if (!internalIsBuffer(buf)) {
          throw new TypeError('"list" argument must be an Array of Buffers')
        }
        buf.copy(buffer, pos);
        pos += buf.length;
      }
      return buffer
    };

    function byteLength (string, encoding) {
      if (internalIsBuffer(string)) {
        return string.length
      }
      if (typeof ArrayBuffer !== 'undefined' && typeof ArrayBuffer.isView === 'function' &&
          (ArrayBuffer.isView(string) || string instanceof ArrayBuffer)) {
        return string.byteLength
      }
      if (typeof string !== 'string') {
        string = '' + string;
      }

      var len = string.length;
      if (len === 0) return 0

      // Use a for loop to avoid recursion
      var loweredCase = false;
      for (;;) {
        switch (encoding) {
          case 'ascii':
          case 'latin1':
          case 'binary':
            return len
          case 'utf8':
          case 'utf-8':
          case undefined:
            return utf8ToBytes(string).length
          case 'ucs2':
          case 'ucs-2':
          case 'utf16le':
          case 'utf-16le':
            return len * 2
          case 'hex':
            return len >>> 1
          case 'base64':
            return base64ToBytes(string).length
          default:
            if (loweredCase) return utf8ToBytes(string).length // assume utf8
            encoding = ('' + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    }
    Buffer.byteLength = byteLength;

    function slowToString (encoding, start, end) {
      var loweredCase = false;

      // No need to verify that "this.length <= MAX_UINT32" since it's a read-only
      // property of a typed array.

      // This behaves neither like String nor Uint8Array in that we set start/end
      // to their upper/lower bounds if the value passed is out of range.
      // undefined is handled specially as per ECMA-262 6th Edition,
      // Section 13.3.3.7 Runtime Semantics: KeyedBindingInitialization.
      if (start === undefined || start < 0) {
        start = 0;
      }
      // Return early if start > this.length. Done here to prevent potential uint32
      // coercion fail below.
      if (start > this.length) {
        return ''
      }

      if (end === undefined || end > this.length) {
        end = this.length;
      }

      if (end <= 0) {
        return ''
      }

      // Force coersion to uint32. This will also coerce falsey/NaN values to 0.
      end >>>= 0;
      start >>>= 0;

      if (end <= start) {
        return ''
      }

      if (!encoding) encoding = 'utf8';

      while (true) {
        switch (encoding) {
          case 'hex':
            return hexSlice(this, start, end)

          case 'utf8':
          case 'utf-8':
            return utf8Slice(this, start, end)

          case 'ascii':
            return asciiSlice(this, start, end)

          case 'latin1':
          case 'binary':
            return latin1Slice(this, start, end)

          case 'base64':
            return base64Slice(this, start, end)

          case 'ucs2':
          case 'ucs-2':
          case 'utf16le':
          case 'utf-16le':
            return utf16leSlice(this, start, end)

          default:
            if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
            encoding = (encoding + '').toLowerCase();
            loweredCase = true;
        }
      }
    }

    // The property is used by `Buffer.isBuffer` and `is-buffer` (in Safari 5-7) to detect
    // Buffer instances.
    Buffer.prototype._isBuffer = true;

    function swap (b, n, m) {
      var i = b[n];
      b[n] = b[m];
      b[m] = i;
    }

    Buffer.prototype.swap16 = function swap16 () {
      var len = this.length;
      if (len % 2 !== 0) {
        throw new RangeError('Buffer size must be a multiple of 16-bits')
      }
      for (var i = 0; i < len; i += 2) {
        swap(this, i, i + 1);
      }
      return this
    };

    Buffer.prototype.swap32 = function swap32 () {
      var len = this.length;
      if (len % 4 !== 0) {
        throw new RangeError('Buffer size must be a multiple of 32-bits')
      }
      for (var i = 0; i < len; i += 4) {
        swap(this, i, i + 3);
        swap(this, i + 1, i + 2);
      }
      return this
    };

    Buffer.prototype.swap64 = function swap64 () {
      var len = this.length;
      if (len % 8 !== 0) {
        throw new RangeError('Buffer size must be a multiple of 64-bits')
      }
      for (var i = 0; i < len; i += 8) {
        swap(this, i, i + 7);
        swap(this, i + 1, i + 6);
        swap(this, i + 2, i + 5);
        swap(this, i + 3, i + 4);
      }
      return this
    };

    Buffer.prototype.toString = function toString () {
      var length = this.length | 0;
      if (length === 0) return ''
      if (arguments.length === 0) return utf8Slice(this, 0, length)
      return slowToString.apply(this, arguments)
    };

    Buffer.prototype.equals = function equals (b) {
      if (!internalIsBuffer(b)) throw new TypeError('Argument must be a Buffer')
      if (this === b) return true
      return Buffer.compare(this, b) === 0
    };

    Buffer.prototype.inspect = function inspect () {
      var str = '';
      var max = INSPECT_MAX_BYTES;
      if (this.length > 0) {
        str = this.toString('hex', 0, max).match(/.{2}/g).join(' ');
        if (this.length > max) str += ' ... ';
      }
      return '<Buffer ' + str + '>'
    };

    Buffer.prototype.compare = function compare (target, start, end, thisStart, thisEnd) {
      if (!internalIsBuffer(target)) {
        throw new TypeError('Argument must be a Buffer')
      }

      if (start === undefined) {
        start = 0;
      }
      if (end === undefined) {
        end = target ? target.length : 0;
      }
      if (thisStart === undefined) {
        thisStart = 0;
      }
      if (thisEnd === undefined) {
        thisEnd = this.length;
      }

      if (start < 0 || end > target.length || thisStart < 0 || thisEnd > this.length) {
        throw new RangeError('out of range index')
      }

      if (thisStart >= thisEnd && start >= end) {
        return 0
      }
      if (thisStart >= thisEnd) {
        return -1
      }
      if (start >= end) {
        return 1
      }

      start >>>= 0;
      end >>>= 0;
      thisStart >>>= 0;
      thisEnd >>>= 0;

      if (this === target) return 0

      var x = thisEnd - thisStart;
      var y = end - start;
      var len = Math.min(x, y);

      var thisCopy = this.slice(thisStart, thisEnd);
      var targetCopy = target.slice(start, end);

      for (var i = 0; i < len; ++i) {
        if (thisCopy[i] !== targetCopy[i]) {
          x = thisCopy[i];
          y = targetCopy[i];
          break
        }
      }

      if (x < y) return -1
      if (y < x) return 1
      return 0
    };

    // Finds either the first index of `val` in `buffer` at offset >= `byteOffset`,
    // OR the last index of `val` in `buffer` at offset <= `byteOffset`.
    //
    // Arguments:
    // - buffer - a Buffer to search
    // - val - a string, Buffer, or number
    // - byteOffset - an index into `buffer`; will be clamped to an int32
    // - encoding - an optional encoding, relevant is val is a string
    // - dir - true for indexOf, false for lastIndexOf
    function bidirectionalIndexOf (buffer, val, byteOffset, encoding, dir) {
      // Empty buffer means no match
      if (buffer.length === 0) return -1

      // Normalize byteOffset
      if (typeof byteOffset === 'string') {
        encoding = byteOffset;
        byteOffset = 0;
      } else if (byteOffset > 0x7fffffff) {
        byteOffset = 0x7fffffff;
      } else if (byteOffset < -0x80000000) {
        byteOffset = -0x80000000;
      }
      byteOffset = +byteOffset;  // Coerce to Number.
      if (isNaN(byteOffset)) {
        // byteOffset: it it's undefined, null, NaN, "foo", etc, search whole buffer
        byteOffset = dir ? 0 : (buffer.length - 1);
      }

      // Normalize byteOffset: negative offsets start from the end of the buffer
      if (byteOffset < 0) byteOffset = buffer.length + byteOffset;
      if (byteOffset >= buffer.length) {
        if (dir) return -1
        else byteOffset = buffer.length - 1;
      } else if (byteOffset < 0) {
        if (dir) byteOffset = 0;
        else return -1
      }

      // Normalize val
      if (typeof val === 'string') {
        val = Buffer.from(val, encoding);
      }

      // Finally, search either indexOf (if dir is true) or lastIndexOf
      if (internalIsBuffer(val)) {
        // Special case: looking for empty string/buffer always fails
        if (val.length === 0) {
          return -1
        }
        return arrayIndexOf(buffer, val, byteOffset, encoding, dir)
      } else if (typeof val === 'number') {
        val = val & 0xFF; // Search for a byte value [0-255]
        if (Buffer.TYPED_ARRAY_SUPPORT &&
            typeof Uint8Array.prototype.indexOf === 'function') {
          if (dir) {
            return Uint8Array.prototype.indexOf.call(buffer, val, byteOffset)
          } else {
            return Uint8Array.prototype.lastIndexOf.call(buffer, val, byteOffset)
          }
        }
        return arrayIndexOf(buffer, [ val ], byteOffset, encoding, dir)
      }

      throw new TypeError('val must be string, number or Buffer')
    }

    function arrayIndexOf (arr, val, byteOffset, encoding, dir) {
      var indexSize = 1;
      var arrLength = arr.length;
      var valLength = val.length;

      if (encoding !== undefined) {
        encoding = String(encoding).toLowerCase();
        if (encoding === 'ucs2' || encoding === 'ucs-2' ||
            encoding === 'utf16le' || encoding === 'utf-16le') {
          if (arr.length < 2 || val.length < 2) {
            return -1
          }
          indexSize = 2;
          arrLength /= 2;
          valLength /= 2;
          byteOffset /= 2;
        }
      }

      function read (buf, i) {
        if (indexSize === 1) {
          return buf[i]
        } else {
          return buf.readUInt16BE(i * indexSize)
        }
      }

      var i;
      if (dir) {
        var foundIndex = -1;
        for (i = byteOffset; i < arrLength; i++) {
          if (read(arr, i) === read(val, foundIndex === -1 ? 0 : i - foundIndex)) {
            if (foundIndex === -1) foundIndex = i;
            if (i - foundIndex + 1 === valLength) return foundIndex * indexSize
          } else {
            if (foundIndex !== -1) i -= i - foundIndex;
            foundIndex = -1;
          }
        }
      } else {
        if (byteOffset + valLength > arrLength) byteOffset = arrLength - valLength;
        for (i = byteOffset; i >= 0; i--) {
          var found = true;
          for (var j = 0; j < valLength; j++) {
            if (read(arr, i + j) !== read(val, j)) {
              found = false;
              break
            }
          }
          if (found) return i
        }
      }

      return -1
    }

    Buffer.prototype.includes = function includes (val, byteOffset, encoding) {
      return this.indexOf(val, byteOffset, encoding) !== -1
    };

    Buffer.prototype.indexOf = function indexOf (val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, true)
    };

    Buffer.prototype.lastIndexOf = function lastIndexOf (val, byteOffset, encoding) {
      return bidirectionalIndexOf(this, val, byteOffset, encoding, false)
    };

    function hexWrite (buf, string, offset, length) {
      offset = Number(offset) || 0;
      var remaining = buf.length - offset;
      if (!length) {
        length = remaining;
      } else {
        length = Number(length);
        if (length > remaining) {
          length = remaining;
        }
      }

      // must be an even number of digits
      var strLen = string.length;
      if (strLen % 2 !== 0) throw new TypeError('Invalid hex string')

      if (length > strLen / 2) {
        length = strLen / 2;
      }
      for (var i = 0; i < length; ++i) {
        var parsed = parseInt(string.substr(i * 2, 2), 16);
        if (isNaN(parsed)) return i
        buf[offset + i] = parsed;
      }
      return i
    }

    function utf8Write (buf, string, offset, length) {
      return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
    }

    function asciiWrite (buf, string, offset, length) {
      return blitBuffer(asciiToBytes(string), buf, offset, length)
    }

    function latin1Write (buf, string, offset, length) {
      return asciiWrite(buf, string, offset, length)
    }

    function base64Write (buf, string, offset, length) {
      return blitBuffer(base64ToBytes(string), buf, offset, length)
    }

    function ucs2Write (buf, string, offset, length) {
      return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
    }

    Buffer.prototype.write = function write (string, offset, length, encoding) {
      // Buffer#write(string)
      if (offset === undefined) {
        encoding = 'utf8';
        length = this.length;
        offset = 0;
      // Buffer#write(string, encoding)
      } else if (length === undefined && typeof offset === 'string') {
        encoding = offset;
        length = this.length;
        offset = 0;
      // Buffer#write(string, offset[, length][, encoding])
      } else if (isFinite(offset)) {
        offset = offset | 0;
        if (isFinite(length)) {
          length = length | 0;
          if (encoding === undefined) encoding = 'utf8';
        } else {
          encoding = length;
          length = undefined;
        }
      // legacy write(string, encoding, offset, length) - remove in v0.13
      } else {
        throw new Error(
          'Buffer.write(string, encoding, offset[, length]) is no longer supported'
        )
      }

      var remaining = this.length - offset;
      if (length === undefined || length > remaining) length = remaining;

      if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
        throw new RangeError('Attempt to write outside buffer bounds')
      }

      if (!encoding) encoding = 'utf8';

      var loweredCase = false;
      for (;;) {
        switch (encoding) {
          case 'hex':
            return hexWrite(this, string, offset, length)

          case 'utf8':
          case 'utf-8':
            return utf8Write(this, string, offset, length)

          case 'ascii':
            return asciiWrite(this, string, offset, length)

          case 'latin1':
          case 'binary':
            return latin1Write(this, string, offset, length)

          case 'base64':
            // Warning: maxLength not taken into account in base64Write
            return base64Write(this, string, offset, length)

          case 'ucs2':
          case 'ucs-2':
          case 'utf16le':
          case 'utf-16le':
            return ucs2Write(this, string, offset, length)

          default:
            if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
            encoding = ('' + encoding).toLowerCase();
            loweredCase = true;
        }
      }
    };

    Buffer.prototype.toJSON = function toJSON () {
      return {
        type: 'Buffer',
        data: Array.prototype.slice.call(this._arr || this, 0)
      }
    };

    function base64Slice (buf, start, end) {
      if (start === 0 && end === buf.length) {
        return fromByteArray(buf)
      } else {
        return fromByteArray(buf.slice(start, end))
      }
    }

    function utf8Slice (buf, start, end) {
      end = Math.min(buf.length, end);
      var res = [];

      var i = start;
      while (i < end) {
        var firstByte = buf[i];
        var codePoint = null;
        var bytesPerSequence = (firstByte > 0xEF) ? 4
          : (firstByte > 0xDF) ? 3
          : (firstByte > 0xBF) ? 2
          : 1;

        if (i + bytesPerSequence <= end) {
          var secondByte, thirdByte, fourthByte, tempCodePoint;

          switch (bytesPerSequence) {
            case 1:
              if (firstByte < 0x80) {
                codePoint = firstByte;
              }
              break
            case 2:
              secondByte = buf[i + 1];
              if ((secondByte & 0xC0) === 0x80) {
                tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F);
                if (tempCodePoint > 0x7F) {
                  codePoint = tempCodePoint;
                }
              }
              break
            case 3:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
                tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F);
                if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
                  codePoint = tempCodePoint;
                }
              }
              break
            case 4:
              secondByte = buf[i + 1];
              thirdByte = buf[i + 2];
              fourthByte = buf[i + 3];
              if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
                tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F);
                if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
                  codePoint = tempCodePoint;
                }
              }
          }
        }

        if (codePoint === null) {
          // we did not generate a valid codePoint so insert a
          // replacement char (U+FFFD) and advance only 1 byte
          codePoint = 0xFFFD;
          bytesPerSequence = 1;
        } else if (codePoint > 0xFFFF) {
          // encode to utf16 (surrogate pair dance)
          codePoint -= 0x10000;
          res.push(codePoint >>> 10 & 0x3FF | 0xD800);
          codePoint = 0xDC00 | codePoint & 0x3FF;
        }

        res.push(codePoint);
        i += bytesPerSequence;
      }

      return decodeCodePointsArray(res)
    }

    // Based on http://stackoverflow.com/a/22747272/680742, the browser with
    // the lowest limit is Chrome, with 0x10000 args.
    // We go 1 magnitude less, for safety
    var MAX_ARGUMENTS_LENGTH = 0x1000;

    function decodeCodePointsArray (codePoints) {
      var len = codePoints.length;
      if (len <= MAX_ARGUMENTS_LENGTH) {
        return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
      }

      // Decode in chunks to avoid "call stack size exceeded".
      var res = '';
      var i = 0;
      while (i < len) {
        res += String.fromCharCode.apply(
          String,
          codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
        );
      }
      return res
    }

    function asciiSlice (buf, start, end) {
      var ret = '';
      end = Math.min(buf.length, end);

      for (var i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i] & 0x7F);
      }
      return ret
    }

    function latin1Slice (buf, start, end) {
      var ret = '';
      end = Math.min(buf.length, end);

      for (var i = start; i < end; ++i) {
        ret += String.fromCharCode(buf[i]);
      }
      return ret
    }

    function hexSlice (buf, start, end) {
      var len = buf.length;

      if (!start || start < 0) start = 0;
      if (!end || end < 0 || end > len) end = len;

      var out = '';
      for (var i = start; i < end; ++i) {
        out += toHex(buf[i]);
      }
      return out
    }

    function utf16leSlice (buf, start, end) {
      var bytes = buf.slice(start, end);
      var res = '';
      for (var i = 0; i < bytes.length; i += 2) {
        res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256);
      }
      return res
    }

    Buffer.prototype.slice = function slice (start, end) {
      var len = this.length;
      start = ~~start;
      end = end === undefined ? len : ~~end;

      if (start < 0) {
        start += len;
        if (start < 0) start = 0;
      } else if (start > len) {
        start = len;
      }

      if (end < 0) {
        end += len;
        if (end < 0) end = 0;
      } else if (end > len) {
        end = len;
      }

      if (end < start) end = start;

      var newBuf;
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        newBuf = this.subarray(start, end);
        newBuf.__proto__ = Buffer.prototype;
      } else {
        var sliceLen = end - start;
        newBuf = new Buffer(sliceLen, undefined);
        for (var i = 0; i < sliceLen; ++i) {
          newBuf[i] = this[i + start];
        }
      }

      return newBuf
    };

    /*
     * Need to make sure that buffer isn't trying to write out of bounds.
     */
    function checkOffset (offset, ext, length) {
      if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
      if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
    }

    Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
      offset = offset | 0;
      byteLength = byteLength | 0;
      if (!noAssert) checkOffset(offset, byteLength, this.length);

      var val = this[offset];
      var mul = 1;
      var i = 0;
      while (++i < byteLength && (mul *= 0x100)) {
        val += this[offset + i] * mul;
      }

      return val
    };

    Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
      offset = offset | 0;
      byteLength = byteLength | 0;
      if (!noAssert) {
        checkOffset(offset, byteLength, this.length);
      }

      var val = this[offset + --byteLength];
      var mul = 1;
      while (byteLength > 0 && (mul *= 0x100)) {
        val += this[offset + --byteLength] * mul;
      }

      return val
    };

    Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 1, this.length);
      return this[offset]
    };

    Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 2, this.length);
      return this[offset] | (this[offset + 1] << 8)
    };

    Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 2, this.length);
      return (this[offset] << 8) | this[offset + 1]
    };

    Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 4, this.length);

      return ((this[offset]) |
          (this[offset + 1] << 8) |
          (this[offset + 2] << 16)) +
          (this[offset + 3] * 0x1000000)
    };

    Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 4, this.length);

      return (this[offset] * 0x1000000) +
        ((this[offset + 1] << 16) |
        (this[offset + 2] << 8) |
        this[offset + 3])
    };

    Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
      offset = offset | 0;
      byteLength = byteLength | 0;
      if (!noAssert) checkOffset(offset, byteLength, this.length);

      var val = this[offset];
      var mul = 1;
      var i = 0;
      while (++i < byteLength && (mul *= 0x100)) {
        val += this[offset + i] * mul;
      }
      mul *= 0x80;

      if (val >= mul) val -= Math.pow(2, 8 * byteLength);

      return val
    };

    Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
      offset = offset | 0;
      byteLength = byteLength | 0;
      if (!noAssert) checkOffset(offset, byteLength, this.length);

      var i = byteLength;
      var mul = 1;
      var val = this[offset + --i];
      while (i > 0 && (mul *= 0x100)) {
        val += this[offset + --i] * mul;
      }
      mul *= 0x80;

      if (val >= mul) val -= Math.pow(2, 8 * byteLength);

      return val
    };

    Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 1, this.length);
      if (!(this[offset] & 0x80)) return (this[offset])
      return ((0xff - this[offset] + 1) * -1)
    };

    Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 2, this.length);
      var val = this[offset] | (this[offset + 1] << 8);
      return (val & 0x8000) ? val | 0xFFFF0000 : val
    };

    Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 2, this.length);
      var val = this[offset + 1] | (this[offset] << 8);
      return (val & 0x8000) ? val | 0xFFFF0000 : val
    };

    Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 4, this.length);

      return (this[offset]) |
        (this[offset + 1] << 8) |
        (this[offset + 2] << 16) |
        (this[offset + 3] << 24)
    };

    Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 4, this.length);

      return (this[offset] << 24) |
        (this[offset + 1] << 16) |
        (this[offset + 2] << 8) |
        (this[offset + 3])
    };

    Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 4, this.length);
      return read(this, offset, true, 23, 4)
    };

    Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 4, this.length);
      return read(this, offset, false, 23, 4)
    };

    Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 8, this.length);
      return read(this, offset, true, 52, 8)
    };

    Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
      if (!noAssert) checkOffset(offset, 8, this.length);
      return read(this, offset, false, 52, 8)
    };

    function checkInt (buf, value, offset, ext, max, min) {
      if (!internalIsBuffer(buf)) throw new TypeError('"buffer" argument must be a Buffer instance')
      if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
      if (offset + ext > buf.length) throw new RangeError('Index out of range')
    }

    Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
      value = +value;
      offset = offset | 0;
      byteLength = byteLength | 0;
      if (!noAssert) {
        var maxBytes = Math.pow(2, 8 * byteLength) - 1;
        checkInt(this, value, offset, byteLength, maxBytes, 0);
      }

      var mul = 1;
      var i = 0;
      this[offset] = value & 0xFF;
      while (++i < byteLength && (mul *= 0x100)) {
        this[offset + i] = (value / mul) & 0xFF;
      }

      return offset + byteLength
    };

    Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
      value = +value;
      offset = offset | 0;
      byteLength = byteLength | 0;
      if (!noAssert) {
        var maxBytes = Math.pow(2, 8 * byteLength) - 1;
        checkInt(this, value, offset, byteLength, maxBytes, 0);
      }

      var i = byteLength - 1;
      var mul = 1;
      this[offset + i] = value & 0xFF;
      while (--i >= 0 && (mul *= 0x100)) {
        this[offset + i] = (value / mul) & 0xFF;
      }

      return offset + byteLength
    };

    Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0);
      if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value);
      this[offset] = (value & 0xff);
      return offset + 1
    };

    function objectWriteUInt16 (buf, value, offset, littleEndian) {
      if (value < 0) value = 0xffff + value + 1;
      for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; ++i) {
        buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
          (littleEndian ? i : 1 - i) * 8;
      }
    }

    Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value & 0xff);
        this[offset + 1] = (value >>> 8);
      } else {
        objectWriteUInt16(this, value, offset, true);
      }
      return offset + 2
    };

    Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value >>> 8);
        this[offset + 1] = (value & 0xff);
      } else {
        objectWriteUInt16(this, value, offset, false);
      }
      return offset + 2
    };

    function objectWriteUInt32 (buf, value, offset, littleEndian) {
      if (value < 0) value = 0xffffffff + value + 1;
      for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; ++i) {
        buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff;
      }
    }

    Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset + 3] = (value >>> 24);
        this[offset + 2] = (value >>> 16);
        this[offset + 1] = (value >>> 8);
        this[offset] = (value & 0xff);
      } else {
        objectWriteUInt32(this, value, offset, true);
      }
      return offset + 4
    };

    Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value >>> 24);
        this[offset + 1] = (value >>> 16);
        this[offset + 2] = (value >>> 8);
        this[offset + 3] = (value & 0xff);
      } else {
        objectWriteUInt32(this, value, offset, false);
      }
      return offset + 4
    };

    Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) {
        var limit = Math.pow(2, 8 * byteLength - 1);

        checkInt(this, value, offset, byteLength, limit - 1, -limit);
      }

      var i = 0;
      var mul = 1;
      var sub = 0;
      this[offset] = value & 0xFF;
      while (++i < byteLength && (mul *= 0x100)) {
        if (value < 0 && sub === 0 && this[offset + i - 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = ((value / mul) >> 0) - sub & 0xFF;
      }

      return offset + byteLength
    };

    Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) {
        var limit = Math.pow(2, 8 * byteLength - 1);

        checkInt(this, value, offset, byteLength, limit - 1, -limit);
      }

      var i = byteLength - 1;
      var mul = 1;
      var sub = 0;
      this[offset + i] = value & 0xFF;
      while (--i >= 0 && (mul *= 0x100)) {
        if (value < 0 && sub === 0 && this[offset + i + 1] !== 0) {
          sub = 1;
        }
        this[offset + i] = ((value / mul) >> 0) - sub & 0xFF;
      }

      return offset + byteLength
    };

    Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80);
      if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value);
      if (value < 0) value = 0xff + value + 1;
      this[offset] = (value & 0xff);
      return offset + 1
    };

    Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value & 0xff);
        this[offset + 1] = (value >>> 8);
      } else {
        objectWriteUInt16(this, value, offset, true);
      }
      return offset + 2
    };

    Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value >>> 8);
        this[offset + 1] = (value & 0xff);
      } else {
        objectWriteUInt16(this, value, offset, false);
      }
      return offset + 2
    };

    Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value & 0xff);
        this[offset + 1] = (value >>> 8);
        this[offset + 2] = (value >>> 16);
        this[offset + 3] = (value >>> 24);
      } else {
        objectWriteUInt32(this, value, offset, true);
      }
      return offset + 4
    };

    Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
      value = +value;
      offset = offset | 0;
      if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000);
      if (value < 0) value = 0xffffffff + value + 1;
      if (Buffer.TYPED_ARRAY_SUPPORT) {
        this[offset] = (value >>> 24);
        this[offset + 1] = (value >>> 16);
        this[offset + 2] = (value >>> 8);
        this[offset + 3] = (value & 0xff);
      } else {
        objectWriteUInt32(this, value, offset, false);
      }
      return offset + 4
    };

    function checkIEEE754 (buf, value, offset, ext, max, min) {
      if (offset + ext > buf.length) throw new RangeError('Index out of range')
      if (offset < 0) throw new RangeError('Index out of range')
    }

    function writeFloat (buf, value, offset, littleEndian, noAssert) {
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 4);
      }
      write(buf, value, offset, littleEndian, 23, 4);
      return offset + 4
    }

    Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
      return writeFloat(this, value, offset, true, noAssert)
    };

    Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
      return writeFloat(this, value, offset, false, noAssert)
    };

    function writeDouble (buf, value, offset, littleEndian, noAssert) {
      if (!noAssert) {
        checkIEEE754(buf, value, offset, 8);
      }
      write(buf, value, offset, littleEndian, 52, 8);
      return offset + 8
    }

    Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
      return writeDouble(this, value, offset, true, noAssert)
    };

    Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
      return writeDouble(this, value, offset, false, noAssert)
    };

    // copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
    Buffer.prototype.copy = function copy (target, targetStart, start, end) {
      if (!start) start = 0;
      if (!end && end !== 0) end = this.length;
      if (targetStart >= target.length) targetStart = target.length;
      if (!targetStart) targetStart = 0;
      if (end > 0 && end < start) end = start;

      // Copy 0 bytes; we're done
      if (end === start) return 0
      if (target.length === 0 || this.length === 0) return 0

      // Fatal error conditions
      if (targetStart < 0) {
        throw new RangeError('targetStart out of bounds')
      }
      if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
      if (end < 0) throw new RangeError('sourceEnd out of bounds')

      // Are we oob?
      if (end > this.length) end = this.length;
      if (target.length - targetStart < end - start) {
        end = target.length - targetStart + start;
      }

      var len = end - start;
      var i;

      if (this === target && start < targetStart && targetStart < end) {
        // descending copy from end
        for (i = len - 1; i >= 0; --i) {
          target[i + targetStart] = this[i + start];
        }
      } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
        // ascending copy from start
        for (i = 0; i < len; ++i) {
          target[i + targetStart] = this[i + start];
        }
      } else {
        Uint8Array.prototype.set.call(
          target,
          this.subarray(start, start + len),
          targetStart
        );
      }

      return len
    };

    // Usage:
    //    buffer.fill(number[, offset[, end]])
    //    buffer.fill(buffer[, offset[, end]])
    //    buffer.fill(string[, offset[, end]][, encoding])
    Buffer.prototype.fill = function fill (val, start, end, encoding) {
      // Handle string cases:
      if (typeof val === 'string') {
        if (typeof start === 'string') {
          encoding = start;
          start = 0;
          end = this.length;
        } else if (typeof end === 'string') {
          encoding = end;
          end = this.length;
        }
        if (val.length === 1) {
          var code = val.charCodeAt(0);
          if (code < 256) {
            val = code;
          }
        }
        if (encoding !== undefined && typeof encoding !== 'string') {
          throw new TypeError('encoding must be a string')
        }
        if (typeof encoding === 'string' && !Buffer.isEncoding(encoding)) {
          throw new TypeError('Unknown encoding: ' + encoding)
        }
      } else if (typeof val === 'number') {
        val = val & 255;
      }

      // Invalid ranges are not set to a default, so can range check early.
      if (start < 0 || this.length < start || this.length < end) {
        throw new RangeError('Out of range index')
      }

      if (end <= start) {
        return this
      }

      start = start >>> 0;
      end = end === undefined ? this.length : end >>> 0;

      if (!val) val = 0;

      var i;
      if (typeof val === 'number') {
        for (i = start; i < end; ++i) {
          this[i] = val;
        }
      } else {
        var bytes = internalIsBuffer(val)
          ? val
          : utf8ToBytes(new Buffer(val, encoding).toString());
        var len = bytes.length;
        for (i = 0; i < end - start; ++i) {
          this[i + start] = bytes[i % len];
        }
      }

      return this
    };

    // HELPER FUNCTIONS
    // ================

    var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g;

    function base64clean (str) {
      // Node strips out invalid characters like \n and \t from the string, base64-js does not
      str = stringtrim(str).replace(INVALID_BASE64_RE, '');
      // Node converts strings with length < 2 to ''
      if (str.length < 2) return ''
      // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
      while (str.length % 4 !== 0) {
        str = str + '=';
      }
      return str
    }

    function stringtrim (str) {
      if (str.trim) return str.trim()
      return str.replace(/^\s+|\s+$/g, '')
    }

    function toHex (n) {
      if (n < 16) return '0' + n.toString(16)
      return n.toString(16)
    }

    function utf8ToBytes (string, units) {
      units = units || Infinity;
      var codePoint;
      var length = string.length;
      var leadSurrogate = null;
      var bytes = [];

      for (var i = 0; i < length; ++i) {
        codePoint = string.charCodeAt(i);

        // is surrogate component
        if (codePoint > 0xD7FF && codePoint < 0xE000) {
          // last char was a lead
          if (!leadSurrogate) {
            // no lead yet
            if (codePoint > 0xDBFF) {
              // unexpected trail
              if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
              continue
            } else if (i + 1 === length) {
              // unpaired lead
              if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
              continue
            }

            // valid lead
            leadSurrogate = codePoint;

            continue
          }

          // 2 leads in a row
          if (codePoint < 0xDC00) {
            if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
            leadSurrogate = codePoint;
            continue
          }

          // valid surrogate pair
          codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000;
        } else if (leadSurrogate) {
          // valid bmp char, but last char was a lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD);
        }

        leadSurrogate = null;

        // encode utf8
        if (codePoint < 0x80) {
          if ((units -= 1) < 0) break
          bytes.push(codePoint);
        } else if (codePoint < 0x800) {
          if ((units -= 2) < 0) break
          bytes.push(
            codePoint >> 0x6 | 0xC0,
            codePoint & 0x3F | 0x80
          );
        } else if (codePoint < 0x10000) {
          if ((units -= 3) < 0) break
          bytes.push(
            codePoint >> 0xC | 0xE0,
            codePoint >> 0x6 & 0x3F | 0x80,
            codePoint & 0x3F | 0x80
          );
        } else if (codePoint < 0x110000) {
          if ((units -= 4) < 0) break
          bytes.push(
            codePoint >> 0x12 | 0xF0,
            codePoint >> 0xC & 0x3F | 0x80,
            codePoint >> 0x6 & 0x3F | 0x80,
            codePoint & 0x3F | 0x80
          );
        } else {
          throw new Error('Invalid code point')
        }
      }

      return bytes
    }

    function asciiToBytes (str) {
      var byteArray = [];
      for (var i = 0; i < str.length; ++i) {
        // Node's code seems to be doing this and not & 0x7F..
        byteArray.push(str.charCodeAt(i) & 0xFF);
      }
      return byteArray
    }

    function utf16leToBytes (str, units) {
      var c, hi, lo;
      var byteArray = [];
      for (var i = 0; i < str.length; ++i) {
        if ((units -= 2) < 0) break

        c = str.charCodeAt(i);
        hi = c >> 8;
        lo = c % 256;
        byteArray.push(lo);
        byteArray.push(hi);
      }

      return byteArray
    }


    function base64ToBytes (str) {
      return toByteArray(base64clean(str))
    }

    function blitBuffer (src, dst, offset, length) {
      for (var i = 0; i < length; ++i) {
        if ((i + offset >= dst.length) || (i >= src.length)) break
        dst[i + offset] = src[i];
      }
      return i
    }

    function isnan (val) {
      return val !== val // eslint-disable-line no-self-compare
    }


    // the following is from is-buffer, also by Feross Aboukhadijeh and with same lisence
    // The _isBuffer check is for Safari 5-7 support, because it's missing
    // Object.prototype.constructor. Remove this eventually
    function isBuffer(obj) {
      return obj != null && (!!obj._isBuffer || isFastBuffer(obj) || isSlowBuffer(obj))
    }

    function isFastBuffer (obj) {
      return !!obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
    }

    // For Node v0.10 support. Remove this eventually.
    function isSlowBuffer (obj) {
      return typeof obj.readFloatLE === 'function' && typeof obj.slice === 'function' && isFastBuffer(obj.slice(0, 0))
    }

    function n(n,t){if(!n){var r,o=new Error("INVARIANT "+t);throw o.stack=o.stack.split("\n").filter(function(n){return !/at invariant/.test(n)}).join("\n"),(r=console).error.apply(r,["\n\n---\n\n",o,"\n\n"].concat([].slice.call(arguments,2),["\n\n---\n\n"])),o}}

    let promise;

    var queueMicrotask_1 = typeof queueMicrotask === 'function'
      ? queueMicrotask
      // reuse resolved promise, and allocate it lazily
      : cb => (promise || (promise = Promise.resolve()))
        .then(cb)
        .catch(err => setTimeout(() => { throw err }, 0));

    function t(){return (t=Object.assign||function(n){for(var t=1;t<arguments.length;t++){var e=arguments[t];for(var r in e)Object.prototype.hasOwnProperty.call(e,r)&&(n[r]=e[r]);}return n}).apply(this,arguments)}function e(n,t){(null==t||t>n.length)&&(t=n.length);for(var e=0,r=new Array(t);e<t;e++)r[e]=n[e];return r}function r(n,t,e){if(!n.s){if(e instanceof o){if(!e.s)return void(e.o=r.bind(null,n,t));1&t&&(t=e.s),e=e.v;}if(e&&e.then)return void e.then(r.bind(null,n,t),r.bind(null,n,2));n.s=t,n.v=e;var i=n.o;i&&i(n);}}var o=function(){function n(){}return n.prototype.then=function(t,e){var o=new n,i=this.s;if(i){var u=1&i?t:e;if(u){try{r(o,1,u(this.v));}catch(n){r(o,2,n);}return o}return this}return this.o=function(n){try{var i=n.v;1&n.s?r(o,1,t?t(i):i):e?r(o,1,e(i)):r(o,2,i);}catch(n){r(o,2,n);}},o},n}();function i(n){return n instanceof o&&1&n.s}function u(n,t,e){for(var u;;){var c=n();if(i(c)&&(c=c.v),!c)return f;if(c.then){u=0;break}var f=e();if(f&&f.then){if(!i(f)){u=1;break}f=f.s;}if(t){var s=t();if(s&&s.then&&!i(s)){u=2;break}}}var a=new o,l=r.bind(null,a,2);return (0===u?c.then(h):1===u?f.then(v):s.then(d)).then(void 0,l),a;function v(o){f=o;do{if(t&&(s=t())&&s.then&&!i(s))return void s.then(d).then(void 0,l);if(!(c=n())||i(c)&&!c.v)return void r(a,1,f);if(c.then)return void c.then(h).then(void 0,l);i(f=e())&&(f=f.v);}while(!f||!f.then);f.then(v).then(void 0,l);}function h(n){n?(f=e())&&f.then?f.then(v).then(void 0,l):v(f):r(a,1,f);}function d(){(c=n())?c.then?c.then(h).then(void 0,l):h(c):r(a,1,f);}}var c="INIT",f="SUBSCRIBE",s="UNSUBSCRIBE",a="UPDATED",l="SNAPSHOT",d="object"==typeof self&&self.self===self&&self||"object"==typeof global$1&&global$1.global===global$1&&global$1||"object"==typeof window&&window.window===window&&window;d.FCL_REGISTRY=null==d.FCL_REGISTRY?{}:d.FCL_REGISTRY;var R=0,b=function(n,t,e,r){return void 0===r&&(r={}),new Promise(function(o,i){var u=r.expectReply||!1,c=null!=r.timeout?r.timeout:5e3;u&&c&&setTimeout(function(){return i(new Error("Timeout: "+c+"ms passed without a response."))},c);var f={to:n,from:r.from,tag:t,data:e,timeout:c,reply:o,reject:i};try{d.FCL_REGISTRY[n].mailbox.deliver(f),u||o(!0);}catch(n){console.error("FCL.Actor -- Could Not Deliver Message",f,n);}})},S=function(n){delete d.FCL_REGISTRY[n];},m=function(r,o){if(void 0===o&&(o=null),null==o&&(o=++R),null!=d.FCL_REGISTRY[o])return o;var i,c;d.FCL_REGISTRY[o]={addr:o,mailbox:(c=[],{deliver:function(n){try{return c.push(n),i&&(i(c.shift()),i=void 0),Promise.resolve()}catch(n){return Promise.reject(n)}},receive:function(){return new Promise(function(n){var t=c.shift();if(t)return n(t);i=n;})}}),subs:new Set,kvs:{}};var f,s={self:function(){return o},receive:function(){return d.FCL_REGISTRY[o].mailbox.receive()},send:function(n,t,e,r){return void 0===r&&(r={}),r.from=o,b(n,t,e,r)},sendSelf:function(n,t,e){d.FCL_REGISTRY[o]&&b(o,n,t,e);},broadcast:function(n,t,r){void 0===r&&(r={}),r.from=o;for(var i,u=function(n,t){var r;if("undefined"==typeof Symbol||null==n[Symbol.iterator]){if(Array.isArray(n)||(r=function(n,t){if(n){if("string"==typeof n)return e(n,void 0);var r=Object.prototype.toString.call(n).slice(8,-1);return "Object"===r&&n.constructor&&(r=n.constructor.name),"Map"===r||"Set"===r?Array.from(n):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?e(n,void 0):void 0}}(n))){r&&(n=r);var o=0;return function(){return o>=n.length?{done:!0}:{done:!1,value:n[o++]}}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}return (r=n[Symbol.iterator]()).next.bind(r)}(d.FCL_REGISTRY[o].subs);!(i=u()).done;)b(i.value,n,t,r);},subscribe:function(n){return null!=n&&d.FCL_REGISTRY[o].subs.add(n)},unsubscribe:function(n){return null!=n&&d.FCL_REGISTRY[o].subs.delete(n)},subscriberCount:function(){return d.FCL_REGISTRY[o].subs.size},hasSubs:function(){return !!d.FCL_REGISTRY[o].subs.size},put:function(n,t){null!=n&&(d.FCL_REGISTRY[o].kvs[n]=t);},get:function(n,t){var e=d.FCL_REGISTRY[o].kvs[n];return null==e?t:e},delete:function(n){delete d.FCL_REGISTRY[o].kvs[n];},update:function(n,t){null!=n&&(d.FCL_REGISTRY[o].kvs[n]=t(d.FCL_REGISTRY[o].kvs[n]));},keys:function(){return Object.keys(d.FCL_REGISTRY[o].kvs)},all:function(){return d.FCL_REGISTRY[o].kvs},where:function(n){return Object.keys(d.FCL_REGISTRY[o].kvs).reduce(function(e,r){var i;return n.test(r)?t({},e,((i={})[r]=d.FCL_REGISTRY[o].kvs[r],i)):e},{})},merge:function(n){void 0===n&&(n={}),Object.keys(n).forEach(function(t){return d.FCL_REGISTRY[o].kvs[t]=n[t]});}};return "object"==typeof r&&(void 0===(f=r)&&(f={}),r=function(n){try{var t=function(){var t=u(function(){return 1},void 0,function(){return Promise.resolve(n.receive()).then(function(t){var e=function(e,r){try{var o=function(e,r){try{var o=function(){function e(){return Promise.resolve(f[t.tag](n,t,t.data||{})).then(function(){})}var r=function(){if("EXIT"===t.tag){var e=function(){if("function"==typeof f.TERMINATE)return Promise.resolve(f.TERMINATE(n,t,t.data||{})).then(function(){})}();if(e&&e.then)return e.then(function(){})}}();return r&&r.then?r.then(e):e()}();}catch(n){return r(n)}return o&&o.then?o.then(void 0,r):o}(0,function(e){console.error(n.self()+" Error",t,e);});}catch(n){return}return o&&o.then?o.then(r.bind(null,!1),r.bind(null,!0)):void 0}(0,function(n,t){});if(e&&e.then)return e.then(function(){})})});return t&&t.then?t.then(function(){}):void 0},e=function(){if("function"==typeof f.INIT)return Promise.resolve(f.INIT(n)).then(function(){})}();return Promise.resolve(e&&e.then?e.then(t):t())}catch(n){return Promise.reject(n)}}),queueMicrotask_1(function(){try{return Promise.resolve(r(s)).then(function(){S(o);})}catch(n){return Promise.reject(n)}}),o};function I(n,t,e){t(n);var r=m(function(t){try{var r;return t.send(n,"SUBSCRIBE"),Promise.resolve(u(function(){return !r&&1},void 0,function(){return Promise.resolve(t.receive()).then(function(o){if("@EXIT"===o.tag)return t.send(n,"UNSUBSCRIBE"),void(r=1);e(o.data);})}))}catch(n){return Promise.reject(n)}});return function(){return b(r,"@EXIT")}}function E(n,t){return t(n),b(n,"SNAPSHOT",null,{expectReply:!0,timeout:0})}

    var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

    function unwrapExports (x) {
    	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
    }

    function createCommonjsModule(fn, module) {
    	return module = { exports: {} }, fn(module, module.exports), module.exports;
    }

    var dist = createCommonjsModule(function (module) {
    module.exports=function(e){var t={};function o(r){if(t[r])return t[r].exports;var s=t[r]={i:r,l:!1,exports:{}};return e[r].call(s.exports,s,s.exports,o),s.l=!0,s.exports}return o.m=e,o.c=t,o.d=function(e,t,r){o.o(e,t)||Object.defineProperty(e,t,{enumerable:!0,get:r});},o.r=function(e){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0});},o.t=function(e,t){if(1&t&&(e=o(e)),8&t)return e;if(4&t&&"object"==typeof e&&e&&e.__esModule)return e;var r=Object.create(null);if(o.r(r),Object.defineProperty(r,"default",{enumerable:!0,value:e}),2&t&&"string"!=typeof e)for(var s in e)o.d(r,s,function(t){return e[t]}.bind(null,s));return r},o.n=function(e){var t=e&&e.__esModule?function(){return e.default}:function(){return e};return o.d(t,"a",t),t},o.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)},o.p="",o(o.s=21)}([function(module,exports){var $jscomp=$jscomp||{};$jscomp.scope={},$jscomp.findInternal=function(e,t,o){e instanceof String&&(e=String(e));for(var r=e.length,s=0;s<r;s++){var n=e[s];if(t.call(o,n,s,e))return {i:s,v:n}}return {i:-1,v:void 0}},$jscomp.ASSUME_ES5=!1,$jscomp.ASSUME_NO_NATIVE_MAP=!1,$jscomp.ASSUME_NO_NATIVE_SET=!1,$jscomp.SIMPLE_FROUND_POLYFILL=!1,$jscomp.defineProperty=$jscomp.ASSUME_ES5||"function"==typeof Object.defineProperties?Object.defineProperty:function(e,t,o){e!=Array.prototype&&e!=Object.prototype&&(e[t]=o.value);},$jscomp.getGlobal=function(e){return "undefined"!=typeof window&&window===e?e:"undefined"!=typeof commonjsGlobal&&null!=commonjsGlobal?commonjsGlobal:e},$jscomp.global=$jscomp.getGlobal(this),$jscomp.polyfill=function(e,t,o,r){if(t){for(o=$jscomp.global,e=e.split("."),r=0;r<e.length-1;r++){var s=e[r];s in o||(o[s]={}),o=o[s];}(t=t(r=o[e=e[e.length-1]]))!=r&&null!=t&&$jscomp.defineProperty(o,e,{configurable:!0,writable:!0,value:t});}},$jscomp.polyfill("Array.prototype.findIndex",(function(e){return e||function(e,t){return $jscomp.findInternal(this,e,t).i}}),"es6","es3"),$jscomp.checkStringArgs=function(e,t,o){if(null==e)throw new TypeError("The 'this' value for String.prototype."+o+" must not be null or undefined");if(t instanceof RegExp)throw new TypeError("First argument to String.prototype."+o+" must not be a regular expression");return e+""},$jscomp.polyfill("String.prototype.endsWith",(function(e){return e||function(e,t){var o=$jscomp.checkStringArgs(this,e,"endsWith");e+="",void 0===t&&(t=o.length),t=Math.max(0,Math.min(0|t,o.length));for(var r=e.length;0<r&&0<t;)if(o[--t]!=e[--r])return !1;return 0>=r}}),"es6","es3"),$jscomp.polyfill("Array.prototype.find",(function(e){return e||function(e,t){return $jscomp.findInternal(this,e,t).v}}),"es6","es3"),$jscomp.polyfill("String.prototype.startsWith",(function(e){return e||function(e,t){var o=$jscomp.checkStringArgs(this,e,"startsWith");e+="";var r=o.length,s=e.length;t=Math.max(0,Math.min(0|t,o.length));for(var n=0;n<s&&t<r;)if(o[t++]!=e[n++])return !1;return n>=s}}),"es6","es3"),$jscomp.polyfill("String.prototype.repeat",(function(e){return e||function(e){var t=$jscomp.checkStringArgs(this,null,"repeat");if(0>e||1342177279<e)throw new RangeError("Invalid count value");e|=0;for(var o="";e;)1&e&&(o+=t),(e>>>=1)&&(t+=t);return o}}),"es6","es3");var COMPILED=!0,goog=goog||{};goog.global=this||self,goog.isDef=function(e){return void 0!==e},goog.isString=function(e){return "string"==typeof e},goog.isBoolean=function(e){return "boolean"==typeof e},goog.isNumber=function(e){return "number"==typeof e},goog.exportPath_=function(e,t,o){e=e.split("."),o=o||goog.global,e[0]in o||void 0===o.execScript||o.execScript("var "+e[0]);for(var r;e.length&&(r=e.shift());)!e.length&&goog.isDef(t)?o[r]=t:o=o[r]&&o[r]!==Object.prototype[r]?o[r]:o[r]={};},goog.define=function(e,t){return t},goog.FEATURESET_YEAR=2012,goog.DEBUG=!0,goog.LOCALE="en",goog.TRUSTED_SITE=!0,goog.STRICT_MODE_COMPATIBLE=!1,goog.DISALLOW_TEST_ONLY_CODE=!goog.DEBUG,goog.ENABLE_CHROME_APP_SAFE_SCRIPT_LOADING=!1,goog.provide=function(e){if(goog.isInModuleLoader_())throw Error("goog.provide cannot be used within a module.");goog.constructNamespace_(e);},goog.constructNamespace_=function(e,t){goog.exportPath_(e,t);},goog.getScriptNonce=function(e){return e&&e!=goog.global?goog.getScriptNonce_(e.document):(null===goog.cspNonce_&&(goog.cspNonce_=goog.getScriptNonce_(goog.global.document)),goog.cspNonce_)},goog.NONCE_PATTERN_=/^[\w+/_-]+[=]{0,2}$/,goog.cspNonce_=null,goog.getScriptNonce_=function(e){return (e=e.querySelector&&e.querySelector("script[nonce]"))&&(e=e.nonce||e.getAttribute("nonce"))&&goog.NONCE_PATTERN_.test(e)?e:""},goog.VALID_MODULE_RE_=/^[a-zA-Z_$][a-zA-Z0-9._$]*$/,goog.module=function(e){if(!goog.isString(e)||!e||-1==e.search(goog.VALID_MODULE_RE_))throw Error("Invalid module identifier");if(!goog.isInGoogModuleLoader_())throw Error("Module "+e+" has been loaded incorrectly. Note, modules cannot be loaded as normal scripts. They require some kind of pre-processing step. You're likely trying to load a module via a script tag or as a part of a concatenated bundle without rewriting the module. For more info see: https://github.com/google/closure-library/wiki/goog.module:-an-ES6-module-like-alternative-to-goog.provide.");if(goog.moduleLoaderState_.moduleName)throw Error("goog.module may only be called once per module.");if(goog.moduleLoaderState_.moduleName=e,!COMPILED);},goog.module.get=function(e){return goog.module.getInternal_(e)},goog.module.getInternal_=function(e){return null},goog.ModuleType={ES6:"es6",GOOG:"goog"},goog.moduleLoaderState_=null,goog.isInModuleLoader_=function(){return goog.isInGoogModuleLoader_()||goog.isInEs6ModuleLoader_()},goog.isInGoogModuleLoader_=function(){return !!goog.moduleLoaderState_&&goog.moduleLoaderState_.type==goog.ModuleType.GOOG},goog.isInEs6ModuleLoader_=function(){if(goog.moduleLoaderState_&&goog.moduleLoaderState_.type==goog.ModuleType.ES6)return !0;var e=goog.global.$jscomp;return !!e&&("function"==typeof e.getCurrentModulePath&&!!e.getCurrentModulePath())},goog.module.declareLegacyNamespace=function(){goog.moduleLoaderState_.declareLegacyNamespace=!0;},goog.declareModuleId=function(e){if(goog.moduleLoaderState_)goog.moduleLoaderState_.moduleName=e;else {var t=goog.global.$jscomp;if(!t||"function"!=typeof t.getCurrentModulePath)throw Error('Module with namespace "'+e+'" has been loaded incorrectly.');t=t.require(t.getCurrentModulePath()),goog.loadedModules_[e]={exports:t,type:goog.ModuleType.ES6,moduleId:e};}},goog.setTestOnly=function(e){if(goog.DISALLOW_TEST_ONLY_CODE)throw e=e||"",Error("Importing test-only code into non-debug environment"+(e?": "+e:"."))},goog.forwardDeclare=function(e){},goog.getObjectByName=function(e,t){e=e.split("."),t=t||goog.global;for(var o=0;o<e.length;o++)if(t=t[e[o]],!goog.isDefAndNotNull(t))return null;return t},goog.globalize=function(e,t){for(var o in t=t||goog.global,e)t[o]=e[o];},goog.addDependency=function(e,t,o,r){},goog.ENABLE_DEBUG_LOADER=!0,goog.logToConsole_=function(e){goog.global.console&&goog.global.console.error(e);},goog.require=function(e){},goog.requireType=function(e){return {}},goog.basePath="",goog.nullFunction=function(){},goog.abstractMethod=function(){throw Error("unimplemented abstract method")},goog.addSingletonGetter=function(e){e.instance_=void 0,e.getInstance=function(){return e.instance_?e.instance_:(goog.DEBUG&&(goog.instantiatedSingletons_[goog.instantiatedSingletons_.length]=e),e.instance_=new e)};},goog.instantiatedSingletons_=[],goog.LOAD_MODULE_USING_EVAL=!0,goog.SEAL_MODULE_EXPORTS=goog.DEBUG,goog.loadedModules_={},goog.DEPENDENCIES_ENABLED=!COMPILED,goog.TRANSPILE="detect",goog.ASSUME_ES_MODULES_TRANSPILED=!1,goog.TRANSPILE_TO_LANGUAGE="",goog.TRANSPILER="transpile.js",goog.hasBadLetScoping=null,goog.useSafari10Workaround=function(){if(null==goog.hasBadLetScoping){try{var a=!eval('"use strict";let x = 1; function f() { return typeof x; };f() == "number";');}catch(e){a=!1;}goog.hasBadLetScoping=a;}return goog.hasBadLetScoping},goog.workaroundSafari10EvalBug=function(e){return "(function(){"+e+"\n;})();\n"},goog.loadModule=function(e){var t=goog.moduleLoaderState_;try{if(goog.moduleLoaderState_={moduleName:"",declareLegacyNamespace:!1,type:goog.ModuleType.GOOG},goog.isFunction(e))var o=e.call(void 0,{});else {if(!goog.isString(e))throw Error("Invalid module definition");goog.useSafari10Workaround()&&(e=goog.workaroundSafari10EvalBug(e)),o=goog.loadModuleFromSource_.call(void 0,e);}var r=goog.moduleLoaderState_.moduleName;if(!goog.isString(r)||!r)throw Error('Invalid module name "'+r+'"');goog.moduleLoaderState_.declareLegacyNamespace?goog.constructNamespace_(r,o):goog.SEAL_MODULE_EXPORTS&&Object.seal&&"object"==typeof o&&null!=o&&Object.seal(o),goog.loadedModules_[r]={exports:o,type:goog.ModuleType.GOOG,moduleId:goog.moduleLoaderState_.moduleName};}finally{goog.moduleLoaderState_=t;}},goog.loadModuleFromSource_=function(a){return eval(a),{}},goog.normalizePath_=function(e){e=e.split("/");for(var t=0;t<e.length;)"."==e[t]?e.splice(t,1):t&&".."==e[t]&&e[t-1]&&".."!=e[t-1]?e.splice(--t,2):t++;return e.join("/")},goog.loadFileSync_=function(e){if(goog.global.CLOSURE_LOAD_FILE_SYNC)return goog.global.CLOSURE_LOAD_FILE_SYNC(e);try{var t=new goog.global.XMLHttpRequest;return t.open("get",e,!1),t.send(),0==t.status||200==t.status?t.responseText:null}catch(e){return null}},goog.transpile_=function(e,t,o){var r=goog.global.$jscomp;r||(goog.global.$jscomp=r={});var s=r.transpile;if(!s){var n=goog.basePath+goog.TRANSPILER,i=goog.loadFileSync_(n);if(i){if(function(){(0, eval)(i+"\n//# sourceURL="+n);}.call(goog.global),goog.global.$gwtExport&&goog.global.$gwtExport.$jscomp&&!goog.global.$gwtExport.$jscomp.transpile)throw Error('The transpiler did not properly export the "transpile" method. $gwtExport: '+JSON.stringify(goog.global.$gwtExport));goog.global.$jscomp.transpile=goog.global.$gwtExport.$jscomp.transpile,s=(r=goog.global.$jscomp).transpile;}}return s||(s=r.transpile=function(e,t){return goog.logToConsole_(t+" requires transpilation but no transpiler was found."),e}),s(e,t,o)},goog.typeOf=function(e){var t=typeof e;if("object"==t){if(!e)return "null";if(e instanceof Array)return "array";if(e instanceof Object)return t;var o=Object.prototype.toString.call(e);if("[object Window]"==o)return "object";if("[object Array]"==o||"number"==typeof e.length&&void 0!==e.splice&&void 0!==e.propertyIsEnumerable&&!e.propertyIsEnumerable("splice"))return "array";if("[object Function]"==o||void 0!==e.call&&void 0!==e.propertyIsEnumerable&&!e.propertyIsEnumerable("call"))return "function"}else if("function"==t&&void 0===e.call)return "object";return t},goog.isNull=function(e){return null===e},goog.isDefAndNotNull=function(e){return null!=e},goog.isArray=function(e){return "array"==goog.typeOf(e)},goog.isArrayLike=function(e){var t=goog.typeOf(e);return "array"==t||"object"==t&&"number"==typeof e.length},goog.isDateLike=function(e){return goog.isObject(e)&&"function"==typeof e.getFullYear},goog.isFunction=function(e){return "function"==goog.typeOf(e)},goog.isObject=function(e){var t=typeof e;return "object"==t&&null!=e||"function"==t},goog.getUid=function(e){return e[goog.UID_PROPERTY_]||(e[goog.UID_PROPERTY_]=++goog.uidCounter_)},goog.hasUid=function(e){return !!e[goog.UID_PROPERTY_]},goog.removeUid=function(e){null!==e&&"removeAttribute"in e&&e.removeAttribute(goog.UID_PROPERTY_);try{delete e[goog.UID_PROPERTY_];}catch(e){}},goog.UID_PROPERTY_="closure_uid_"+(1e9*Math.random()>>>0),goog.uidCounter_=0,goog.getHashCode=goog.getUid,goog.removeHashCode=goog.removeUid,goog.cloneObject=function(e){var t=goog.typeOf(e);if("object"==t||"array"==t){if("function"==typeof e.clone)return e.clone();for(var o in t="array"==t?[]:{},e)t[o]=goog.cloneObject(e[o]);return t}return e},goog.bindNative_=function(e,t,o){return e.call.apply(e.bind,arguments)},goog.bindJs_=function(e,t,o){if(!e)throw Error();if(2<arguments.length){var r=Array.prototype.slice.call(arguments,2);return function(){var o=Array.prototype.slice.call(arguments);return Array.prototype.unshift.apply(o,r),e.apply(t,o)}}return function(){return e.apply(t,arguments)}},goog.bind=function(e,t,o){return Function.prototype.bind&&-1!=Function.prototype.bind.toString().indexOf("native code")?goog.bind=goog.bindNative_:goog.bind=goog.bindJs_,goog.bind.apply(null,arguments)},goog.partial=function(e,t){var o=Array.prototype.slice.call(arguments,1);return function(){var t=o.slice();return t.push.apply(t,arguments),e.apply(this,t)}},goog.mixin=function(e,t){for(var o in t)e[o]=t[o];},goog.now=goog.TRUSTED_SITE&&Date.now||function(){return +new Date},goog.globalEval=function(e){if(goog.global.execScript)goog.global.execScript(e,"JavaScript");else {if(!goog.global.eval)throw Error("goog.globalEval not available");if(null==goog.evalWorksForGlobals_){try{goog.global.eval("var _evalTest_ = 1;");}catch(e){}if(void 0!==goog.global._evalTest_){try{delete goog.global._evalTest_;}catch(e){}goog.evalWorksForGlobals_=!0;}else goog.evalWorksForGlobals_=!1;}if(goog.evalWorksForGlobals_)goog.global.eval(e);else {var t=goog.global.document,o=t.createElement("SCRIPT");o.type="text/javascript",o.defer=!1,o.appendChild(t.createTextNode(e)),t.head.appendChild(o),t.head.removeChild(o);}}},goog.evalWorksForGlobals_=null,goog.getCssName=function(e,t){if("."==String(e).charAt(0))throw Error('className passed in goog.getCssName must not start with ".". You passed: '+e);var o=function(e){return goog.cssNameMapping_[e]||e},r=function(e){e=e.split("-");for(var t=[],r=0;r<e.length;r++)t.push(o(e[r]));return t.join("-")};return r=goog.cssNameMapping_?"BY_WHOLE"==goog.cssNameMappingStyle_?o:r:function(e){return e},e=t?e+"-"+r(t):r(e),goog.global.CLOSURE_CSS_NAME_MAP_FN?goog.global.CLOSURE_CSS_NAME_MAP_FN(e):e},goog.setCssNameMapping=function(e,t){goog.cssNameMapping_=e,goog.cssNameMappingStyle_=t;},goog.getMsg=function(e,t,o){return o&&o.html&&(e=e.replace(/</g,"&lt;")),t&&(e=e.replace(/\{\$([^}]+)}/g,(function(e,o){return null!=t&&o in t?t[o]:e}))),e},goog.getMsgWithFallback=function(e,t){return e},goog.exportSymbol=function(e,t,o){goog.exportPath_(e,t,o);},goog.exportProperty=function(e,t,o){e[t]=o;},goog.inherits=function(e,t){function o(){}o.prototype=t.prototype,e.superClass_=t.prototype,e.prototype=new o,e.prototype.constructor=e,e.base=function(e,o,r){for(var s=Array(arguments.length-2),n=2;n<arguments.length;n++)s[n-2]=arguments[n];return t.prototype[o].apply(e,s)};},goog.base=function(e,t,o){var r=arguments.callee.caller;if(goog.STRICT_MODE_COMPATIBLE||goog.DEBUG&&!r)throw Error("arguments.caller not defined.  goog.base() cannot be used with strict mode code. See http://www.ecma-international.org/ecma-262/5.1/#sec-C");if(void 0!==r.superClass_){for(var s=Array(arguments.length-1),n=1;n<arguments.length;n++)s[n-1]=arguments[n];return r.superClass_.constructor.apply(e,s)}if("string"!=typeof t&&"symbol"!=typeof t)throw Error("method names provided to goog.base must be a string or a symbol");for(s=Array(arguments.length-2),n=2;n<arguments.length;n++)s[n-2]=arguments[n];n=!1;for(var i=e.constructor.prototype;i;i=Object.getPrototypeOf(i))if(i[t]===r)n=!0;else if(n)return i[t].apply(e,s);if(e[t]===r)return e.constructor.prototype[t].apply(e,s);throw Error("goog.base called from a method of one name to a method of a different name")},goog.scope=function(e){if(goog.isInModuleLoader_())throw Error("goog.scope is not supported within a module.");e.call(goog.global);},goog.defineClass=function(e,t){var o=t.constructor,r=t.statics;return o&&o!=Object.prototype.constructor||(o=function(){throw Error("cannot instantiate an interface (no constructor defined).")}),o=goog.defineClass.createSealingConstructor_(o,e),e&&goog.inherits(o,e),delete t.constructor,delete t.statics,goog.defineClass.applyProperties_(o.prototype,t),null!=r&&(r instanceof Function?r(o):goog.defineClass.applyProperties_(o,r)),o},goog.defineClass.SEAL_CLASS_INSTANCES=goog.DEBUG,goog.defineClass.createSealingConstructor_=function(e,t){if(!goog.defineClass.SEAL_CLASS_INSTANCES)return e;var o=!goog.defineClass.isUnsealable_(t),r=function(){var t=e.apply(this,arguments)||this;return t[goog.UID_PROPERTY_]=t[goog.UID_PROPERTY_],this.constructor===r&&o&&Object.seal instanceof Function&&Object.seal(t),t};return r},goog.defineClass.isUnsealable_=function(e){return e&&e.prototype&&e.prototype[goog.UNSEALABLE_CONSTRUCTOR_PROPERTY_]},goog.defineClass.OBJECT_PROTOTYPE_FIELDS_="constructor hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf".split(" "),goog.defineClass.applyProperties_=function(e,t){for(var o in t)Object.prototype.hasOwnProperty.call(t,o)&&(e[o]=t[o]);for(var r=0;r<goog.defineClass.OBJECT_PROTOTYPE_FIELDS_.length;r++)o=goog.defineClass.OBJECT_PROTOTYPE_FIELDS_[r],Object.prototype.hasOwnProperty.call(t,o)&&(e[o]=t[o]);},goog.tagUnsealableClass=function(e){},goog.UNSEALABLE_CONSTRUCTOR_PROPERTY_="goog_defineClass_legacy_unsealable",goog.TRUSTED_TYPES_POLICY_NAME="",goog.identity_=function(e){return e},goog.createTrustedTypesPolicy=function(e){var t=null;if("undefined"==typeof TrustedTypes||!TrustedTypes.createPolicy)return t;try{t=TrustedTypes.createPolicy(e,{createHTML:goog.identity_,createScript:goog.identity_,createScriptURL:goog.identity_,createURL:goog.identity_});}catch(e){goog.logToConsole_(e.message);}return t},goog.TRUSTED_TYPES_POLICY_=goog.TRUSTED_TYPES_POLICY_NAME?goog.createTrustedTypesPolicy(goog.TRUSTED_TYPES_POLICY_NAME+"#base"):null;var jspb={BinaryConstants:{},ConstBinaryMessage:function(){},BinaryMessage:function(){}};jspb.BinaryConstants.FieldType={INVALID:-1,DOUBLE:1,FLOAT:2,INT64:3,UINT64:4,INT32:5,FIXED64:6,FIXED32:7,BOOL:8,STRING:9,GROUP:10,MESSAGE:11,BYTES:12,UINT32:13,ENUM:14,SFIXED32:15,SFIXED64:16,SINT32:17,SINT64:18,FHASH64:30,VHASH64:31},jspb.BinaryConstants.WireType={INVALID:-1,VARINT:0,FIXED64:1,DELIMITED:2,START_GROUP:3,END_GROUP:4,FIXED32:5},jspb.BinaryConstants.FieldTypeToWireType=function(e){var t=jspb.BinaryConstants.FieldType,o=jspb.BinaryConstants.WireType;switch(e){case t.INT32:case t.INT64:case t.UINT32:case t.UINT64:case t.SINT32:case t.SINT64:case t.BOOL:case t.ENUM:case t.VHASH64:return o.VARINT;case t.DOUBLE:case t.FIXED64:case t.SFIXED64:case t.FHASH64:return o.FIXED64;case t.STRING:case t.MESSAGE:case t.BYTES:return o.DELIMITED;case t.FLOAT:case t.FIXED32:case t.SFIXED32:return o.FIXED32;default:return o.INVALID}},jspb.BinaryConstants.INVALID_FIELD_NUMBER=-1,jspb.BinaryConstants.FLOAT32_EPS=1401298464324817e-60,jspb.BinaryConstants.FLOAT32_MIN=11754943508222875e-54,jspb.BinaryConstants.FLOAT32_MAX=34028234663852886e22,jspb.BinaryConstants.FLOAT64_EPS=5e-324,jspb.BinaryConstants.FLOAT64_MIN=22250738585072014e-324,jspb.BinaryConstants.FLOAT64_MAX=17976931348623157e292,jspb.BinaryConstants.TWO_TO_20=1048576,jspb.BinaryConstants.TWO_TO_23=8388608,jspb.BinaryConstants.TWO_TO_31=2147483648,jspb.BinaryConstants.TWO_TO_32=4294967296,jspb.BinaryConstants.TWO_TO_52=4503599627370496,jspb.BinaryConstants.TWO_TO_63=0x8000000000000000,jspb.BinaryConstants.TWO_TO_64=0x10000000000000000,jspb.BinaryConstants.ZERO_HASH="\0\0\0\0\0\0\0\0",goog.dom={},goog.dom.NodeType={ELEMENT:1,ATTRIBUTE:2,TEXT:3,CDATA_SECTION:4,ENTITY_REFERENCE:5,ENTITY:6,PROCESSING_INSTRUCTION:7,COMMENT:8,DOCUMENT:9,DOCUMENT_TYPE:10,DOCUMENT_FRAGMENT:11,NOTATION:12},goog.debug={},goog.debug.Error=function(e){if(Error.captureStackTrace)Error.captureStackTrace(this,goog.debug.Error);else {var t=Error().stack;t&&(this.stack=t);}e&&(this.message=String(e)),this.reportErrorToServer=!0;},goog.inherits(goog.debug.Error,Error),goog.debug.Error.prototype.name="CustomError",goog.asserts={},goog.asserts.ENABLE_ASSERTS=goog.DEBUG,goog.asserts.AssertionError=function(e,t){goog.debug.Error.call(this,goog.asserts.subs_(e,t)),this.messagePattern=e;},goog.inherits(goog.asserts.AssertionError,goog.debug.Error),goog.asserts.AssertionError.prototype.name="AssertionError",goog.asserts.DEFAULT_ERROR_HANDLER=function(e){throw e},goog.asserts.errorHandler_=goog.asserts.DEFAULT_ERROR_HANDLER,goog.asserts.subs_=function(e,t){for(var o="",r=(e=e.split("%s")).length-1,s=0;s<r;s++)o+=e[s]+(s<t.length?t[s]:"%s");return o+e[r]},goog.asserts.doAssertFailure_=function(e,t,o,r){var s="Assertion failed";if(o){s+=": "+o;var n=r;}else e&&(s+=": "+e,n=t);e=new goog.asserts.AssertionError(""+s,n||[]),goog.asserts.errorHandler_(e);},goog.asserts.setErrorHandler=function(e){goog.asserts.ENABLE_ASSERTS&&(goog.asserts.errorHandler_=e);},goog.asserts.assert=function(e,t,o){return goog.asserts.ENABLE_ASSERTS&&!e&&goog.asserts.doAssertFailure_("",null,t,Array.prototype.slice.call(arguments,2)),e},goog.asserts.assertExists=function(e,t,o){return goog.asserts.ENABLE_ASSERTS&&null==e&&goog.asserts.doAssertFailure_("Expected to exist: %s.",[e],t,Array.prototype.slice.call(arguments,2)),e},goog.asserts.fail=function(e,t){goog.asserts.ENABLE_ASSERTS&&goog.asserts.errorHandler_(new goog.asserts.AssertionError("Failure"+(e?": "+e:""),Array.prototype.slice.call(arguments,1)));},goog.asserts.assertNumber=function(e,t,o){return goog.asserts.ENABLE_ASSERTS&&!goog.isNumber(e)&&goog.asserts.doAssertFailure_("Expected number but got %s: %s.",[goog.typeOf(e),e],t,Array.prototype.slice.call(arguments,2)),e},goog.asserts.assertString=function(e,t,o){return goog.asserts.ENABLE_ASSERTS&&!goog.isString(e)&&goog.asserts.doAssertFailure_("Expected string but got %s: %s.",[goog.typeOf(e),e],t,Array.prototype.slice.call(arguments,2)),e},goog.asserts.assertFunction=function(e,t,o){return goog.asserts.ENABLE_ASSERTS&&!goog.isFunction(e)&&goog.asserts.doAssertFailure_("Expected function but got %s: %s.",[goog.typeOf(e),e],t,Array.prototype.slice.call(arguments,2)),e},goog.asserts.assertObject=function(e,t,o){return goog.asserts.ENABLE_ASSERTS&&!goog.isObject(e)&&goog.asserts.doAssertFailure_("Expected object but got %s: %s.",[goog.typeOf(e),e],t,Array.prototype.slice.call(arguments,2)),e},goog.asserts.assertArray=function(e,t,o){return goog.asserts.ENABLE_ASSERTS&&!goog.isArray(e)&&goog.asserts.doAssertFailure_("Expected array but got %s: %s.",[goog.typeOf(e),e],t,Array.prototype.slice.call(arguments,2)),e},goog.asserts.assertBoolean=function(e,t,o){return goog.asserts.ENABLE_ASSERTS&&!goog.isBoolean(e)&&goog.asserts.doAssertFailure_("Expected boolean but got %s: %s.",[goog.typeOf(e),e],t,Array.prototype.slice.call(arguments,2)),e},goog.asserts.assertElement=function(e,t,o){return !goog.asserts.ENABLE_ASSERTS||goog.isObject(e)&&e.nodeType==goog.dom.NodeType.ELEMENT||goog.asserts.doAssertFailure_("Expected Element but got %s: %s.",[goog.typeOf(e),e],t,Array.prototype.slice.call(arguments,2)),e},goog.asserts.assertInstanceof=function(e,t,o,r){return !goog.asserts.ENABLE_ASSERTS||e instanceof t||goog.asserts.doAssertFailure_("Expected instanceof %s but got %s.",[goog.asserts.getType_(t),goog.asserts.getType_(e)],o,Array.prototype.slice.call(arguments,3)),e},goog.asserts.assertFinite=function(e,t,o){return !goog.asserts.ENABLE_ASSERTS||"number"==typeof e&&isFinite(e)||goog.asserts.doAssertFailure_("Expected %s to be a finite number but it is not.",[e],t,Array.prototype.slice.call(arguments,2)),e},goog.asserts.assertObjectPrototypeIsIntact=function(){for(var e in Object.prototype)goog.asserts.fail(e+" should not be enumerable in Object.prototype.");},goog.asserts.getType_=function(e){return e instanceof Function?e.displayName||e.name||"unknown type name":e instanceof Object?e.constructor.displayName||e.constructor.name||Object.prototype.toString.call(e):null===e?"null":typeof e},goog.array={},goog.NATIVE_ARRAY_PROTOTYPES=goog.TRUSTED_SITE,goog.array.ASSUME_NATIVE_FUNCTIONS=2012<goog.FEATURESET_YEAR,goog.array.peek=function(e){return e[e.length-1]},goog.array.last=goog.array.peek,goog.array.indexOf=goog.NATIVE_ARRAY_PROTOTYPES&&(goog.array.ASSUME_NATIVE_FUNCTIONS||Array.prototype.indexOf)?function(e,t,o){return goog.asserts.assert(null!=e.length),Array.prototype.indexOf.call(e,t,o)}:function(e,t,o){if(o=null==o?0:0>o?Math.max(0,e.length+o):o,goog.isString(e))return goog.isString(t)&&1==t.length?e.indexOf(t,o):-1;for(;o<e.length;o++)if(o in e&&e[o]===t)return o;return -1},goog.array.lastIndexOf=goog.NATIVE_ARRAY_PROTOTYPES&&(goog.array.ASSUME_NATIVE_FUNCTIONS||Array.prototype.lastIndexOf)?function(e,t,o){return goog.asserts.assert(null!=e.length),Array.prototype.lastIndexOf.call(e,t,null==o?e.length-1:o)}:function(e,t,o){if(0>(o=null==o?e.length-1:o)&&(o=Math.max(0,e.length+o)),goog.isString(e))return goog.isString(t)&&1==t.length?e.lastIndexOf(t,o):-1;for(;0<=o;o--)if(o in e&&e[o]===t)return o;return -1},goog.array.forEach=goog.NATIVE_ARRAY_PROTOTYPES&&(goog.array.ASSUME_NATIVE_FUNCTIONS||Array.prototype.forEach)?function(e,t,o){goog.asserts.assert(null!=e.length),Array.prototype.forEach.call(e,t,o);}:function(e,t,o){for(var r=e.length,s=goog.isString(e)?e.split(""):e,n=0;n<r;n++)n in s&&t.call(o,s[n],n,e);},goog.array.forEachRight=function(e,t,o){var r=e.length,s=goog.isString(e)?e.split(""):e;for(--r;0<=r;--r)r in s&&t.call(o,s[r],r,e);},goog.array.filter=goog.NATIVE_ARRAY_PROTOTYPES&&(goog.array.ASSUME_NATIVE_FUNCTIONS||Array.prototype.filter)?function(e,t,o){return goog.asserts.assert(null!=e.length),Array.prototype.filter.call(e,t,o)}:function(e,t,o){for(var r=e.length,s=[],n=0,i=goog.isString(e)?e.split(""):e,a=0;a<r;a++)if(a in i){var g=i[a];t.call(o,g,a,e)&&(s[n++]=g);}return s},goog.array.map=goog.NATIVE_ARRAY_PROTOTYPES&&(goog.array.ASSUME_NATIVE_FUNCTIONS||Array.prototype.map)?function(e,t,o){return goog.asserts.assert(null!=e.length),Array.prototype.map.call(e,t,o)}:function(e,t,o){for(var r=e.length,s=Array(r),n=goog.isString(e)?e.split(""):e,i=0;i<r;i++)i in n&&(s[i]=t.call(o,n[i],i,e));return s},goog.array.reduce=goog.NATIVE_ARRAY_PROTOTYPES&&(goog.array.ASSUME_NATIVE_FUNCTIONS||Array.prototype.reduce)?function(e,t,o,r){return goog.asserts.assert(null!=e.length),r&&(t=goog.bind(t,r)),Array.prototype.reduce.call(e,t,o)}:function(e,t,o,r){var s=o;return goog.array.forEach(e,(function(o,n){s=t.call(r,s,o,n,e);})),s},goog.array.reduceRight=goog.NATIVE_ARRAY_PROTOTYPES&&(goog.array.ASSUME_NATIVE_FUNCTIONS||Array.prototype.reduceRight)?function(e,t,o,r){return goog.asserts.assert(null!=e.length),goog.asserts.assert(null!=t),r&&(t=goog.bind(t,r)),Array.prototype.reduceRight.call(e,t,o)}:function(e,t,o,r){var s=o;return goog.array.forEachRight(e,(function(o,n){s=t.call(r,s,o,n,e);})),s},goog.array.some=goog.NATIVE_ARRAY_PROTOTYPES&&(goog.array.ASSUME_NATIVE_FUNCTIONS||Array.prototype.some)?function(e,t,o){return goog.asserts.assert(null!=e.length),Array.prototype.some.call(e,t,o)}:function(e,t,o){for(var r=e.length,s=goog.isString(e)?e.split(""):e,n=0;n<r;n++)if(n in s&&t.call(o,s[n],n,e))return !0;return !1},goog.array.every=goog.NATIVE_ARRAY_PROTOTYPES&&(goog.array.ASSUME_NATIVE_FUNCTIONS||Array.prototype.every)?function(e,t,o){return goog.asserts.assert(null!=e.length),Array.prototype.every.call(e,t,o)}:function(e,t,o){for(var r=e.length,s=goog.isString(e)?e.split(""):e,n=0;n<r;n++)if(n in s&&!t.call(o,s[n],n,e))return !1;return !0},goog.array.count=function(e,t,o){var r=0;return goog.array.forEach(e,(function(e,s,n){t.call(o,e,s,n)&&++r;}),o),r},goog.array.find=function(e,t,o){return 0>(t=goog.array.findIndex(e,t,o))?null:goog.isString(e)?e.charAt(t):e[t]},goog.array.findIndex=function(e,t,o){for(var r=e.length,s=goog.isString(e)?e.split(""):e,n=0;n<r;n++)if(n in s&&t.call(o,s[n],n,e))return n;return -1},goog.array.findRight=function(e,t,o){return 0>(t=goog.array.findIndexRight(e,t,o))?null:goog.isString(e)?e.charAt(t):e[t]},goog.array.findIndexRight=function(e,t,o){var r=e.length,s=goog.isString(e)?e.split(""):e;for(--r;0<=r;r--)if(r in s&&t.call(o,s[r],r,e))return r;return -1},goog.array.contains=function(e,t){return 0<=goog.array.indexOf(e,t)},goog.array.isEmpty=function(e){return 0==e.length},goog.array.clear=function(e){if(!goog.isArray(e))for(var t=e.length-1;0<=t;t--)delete e[t];e.length=0;},goog.array.insert=function(e,t){goog.array.contains(e,t)||e.push(t);},goog.array.insertAt=function(e,t,o){goog.array.splice(e,o,0,t);},goog.array.insertArrayAt=function(e,t,o){goog.partial(goog.array.splice,e,o,0).apply(null,t);},goog.array.insertBefore=function(e,t,o){var r;2==arguments.length||0>(r=goog.array.indexOf(e,o))?e.push(t):goog.array.insertAt(e,t,r);},goog.array.remove=function(e,t){var o;return (o=0<=(t=goog.array.indexOf(e,t)))&&goog.array.removeAt(e,t),o},goog.array.removeLast=function(e,t){return 0<=(t=goog.array.lastIndexOf(e,t))&&(goog.array.removeAt(e,t),!0)},goog.array.removeAt=function(e,t){return goog.asserts.assert(null!=e.length),1==Array.prototype.splice.call(e,t,1).length},goog.array.removeIf=function(e,t,o){return 0<=(t=goog.array.findIndex(e,t,o))&&(goog.array.removeAt(e,t),!0)},goog.array.removeAllIf=function(e,t,o){var r=0;return goog.array.forEachRight(e,(function(s,n){t.call(o,s,n,e)&&goog.array.removeAt(e,n)&&r++;})),r},goog.array.concat=function(e){return Array.prototype.concat.apply([],arguments)},goog.array.join=function(e){return Array.prototype.concat.apply([],arguments)},goog.array.toArray=function(e){var t=e.length;if(0<t){for(var o=Array(t),r=0;r<t;r++)o[r]=e[r];return o}return []},goog.array.clone=goog.array.toArray,goog.array.extend=function(e,t){for(var o=1;o<arguments.length;o++){var r=arguments[o];if(goog.isArrayLike(r)){var s=e.length||0,n=r.length||0;e.length=s+n;for(var i=0;i<n;i++)e[s+i]=r[i];}else e.push(r);}},goog.array.splice=function(e,t,o,r){return goog.asserts.assert(null!=e.length),Array.prototype.splice.apply(e,goog.array.slice(arguments,1))},goog.array.slice=function(e,t,o){return goog.asserts.assert(null!=e.length),2>=arguments.length?Array.prototype.slice.call(e,t):Array.prototype.slice.call(e,t,o)},goog.array.removeDuplicates=function(e,t,o){t=t||e;var r=function(e){return goog.isObject(e)?"o"+goog.getUid(e):(typeof e).charAt(0)+e};o=o||r,r={};for(var s=0,n=0;n<e.length;){var i=e[n++],a=o(i);Object.prototype.hasOwnProperty.call(r,a)||(r[a]=!0,t[s++]=i);}t.length=s;},goog.array.binarySearch=function(e,t,o){return goog.array.binarySearch_(e,o||goog.array.defaultCompare,!1,t)},goog.array.binarySelect=function(e,t,o){return goog.array.binarySearch_(e,t,!0,void 0,o)},goog.array.binarySearch_=function(e,t,o,r,s){for(var n,i=0,a=e.length;i<a;){var g=i+a>>1,l=o?t.call(s,e[g],g,e):t(r,e[g]);0<l?i=g+1:(a=g,n=!l);}return n?i:~i},goog.array.sort=function(e,t){e.sort(t||goog.array.defaultCompare);},goog.array.stableSort=function(e,t){for(var o=Array(e.length),r=0;r<e.length;r++)o[r]={index:r,value:e[r]};var s=t||goog.array.defaultCompare;for(goog.array.sort(o,(function(e,t){return s(e.value,t.value)||e.index-t.index})),r=0;r<e.length;r++)e[r]=o[r].value;},goog.array.sortByKey=function(e,t,o){var r=o||goog.array.defaultCompare;goog.array.sort(e,(function(e,o){return r(t(e),t(o))}));},goog.array.sortObjectsByKey=function(e,t,o){goog.array.sortByKey(e,(function(e){return e[t]}),o);},goog.array.isSorted=function(e,t,o){t=t||goog.array.defaultCompare;for(var r=1;r<e.length;r++){var s=t(e[r-1],e[r]);if(0<s||0==s&&o)return !1}return !0},goog.array.equals=function(e,t,o){if(!goog.isArrayLike(e)||!goog.isArrayLike(t)||e.length!=t.length)return !1;var r=e.length;o=o||goog.array.defaultCompareEquality;for(var s=0;s<r;s++)if(!o(e[s],t[s]))return !1;return !0},goog.array.compare3=function(e,t,o){o=o||goog.array.defaultCompare;for(var r=Math.min(e.length,t.length),s=0;s<r;s++){var n=o(e[s],t[s]);if(0!=n)return n}return goog.array.defaultCompare(e.length,t.length)},goog.array.defaultCompare=function(e,t){return e>t?1:e<t?-1:0},goog.array.inverseDefaultCompare=function(e,t){return -goog.array.defaultCompare(e,t)},goog.array.defaultCompareEquality=function(e,t){return e===t},goog.array.binaryInsert=function(e,t,o){return 0>(o=goog.array.binarySearch(e,t,o))&&(goog.array.insertAt(e,t,-(o+1)),!0)},goog.array.binaryRemove=function(e,t,o){return 0<=(t=goog.array.binarySearch(e,t,o))&&goog.array.removeAt(e,t)},goog.array.bucket=function(e,t,o){for(var r={},s=0;s<e.length;s++){var n=e[s],i=t.call(o,n,s,e);goog.isDef(i)&&(r[i]||(r[i]=[])).push(n);}return r},goog.array.toObject=function(e,t,o){var r={};return goog.array.forEach(e,(function(s,n){r[t.call(o,s,n,e)]=s;})),r},goog.array.range=function(e,t,o){var r=[],s=0,n=e;if(void 0!==t&&(s=e,n=t),0>(o=o||1)*(n-s))return [];if(0<o)for(e=s;e<n;e+=o)r.push(e);else for(e=s;e>n;e+=o)r.push(e);return r},goog.array.repeat=function(e,t){for(var o=[],r=0;r<t;r++)o[r]=e;return o},goog.array.flatten=function(e){for(var t=[],o=0;o<arguments.length;o++){var r=arguments[o];if(goog.isArray(r))for(var s=0;s<r.length;s+=8192){var n=goog.array.slice(r,s,s+8192);n=goog.array.flatten.apply(null,n);for(var i=0;i<n.length;i++)t.push(n[i]);}else t.push(r);}return t},goog.array.rotate=function(e,t){return goog.asserts.assert(null!=e.length),e.length&&(0<(t%=e.length)?Array.prototype.unshift.apply(e,e.splice(-t,t)):0>t&&Array.prototype.push.apply(e,e.splice(0,-t))),e},goog.array.moveItem=function(e,t,o){goog.asserts.assert(0<=t&&t<e.length),goog.asserts.assert(0<=o&&o<e.length),t=Array.prototype.splice.call(e,t,1),Array.prototype.splice.call(e,o,0,t[0]);},goog.array.zip=function(e){if(!arguments.length)return [];for(var t=[],o=arguments[0].length,r=1;r<arguments.length;r++)arguments[r].length<o&&(o=arguments[r].length);for(r=0;r<o;r++){for(var s=[],n=0;n<arguments.length;n++)s.push(arguments[n][r]);t.push(s);}return t},goog.array.shuffle=function(e,t){t=t||Math.random;for(var o=e.length-1;0<o;o--){var r=Math.floor(t()*(o+1)),s=e[o];e[o]=e[r],e[r]=s;}},goog.array.copyByIndex=function(e,t){var o=[];return goog.array.forEach(t,(function(t){o.push(e[t]);})),o},goog.array.concatMap=function(e,t,o){return goog.array.concat.apply([],goog.array.map(e,t,o))},goog.crypt={},goog.crypt.stringToByteArray=function(e){for(var t=[],o=0,r=0;r<e.length;r++){var s=e.charCodeAt(r);255<s&&(t[o++]=255&s,s>>=8),t[o++]=s;}return t},goog.crypt.byteArrayToString=function(e){if(8192>=e.length)return String.fromCharCode.apply(null,e);for(var t="",o=0;o<e.length;o+=8192){var r=goog.array.slice(e,o,o+8192);t+=String.fromCharCode.apply(null,r);}return t},goog.crypt.byteArrayToHex=function(e,t){return goog.array.map(e,(function(e){return 1<(e=e.toString(16)).length?e:"0"+e})).join(t||"")},goog.crypt.hexToByteArray=function(e){goog.asserts.assert(0==e.length%2,"Key string length must be multiple of 2");for(var t=[],o=0;o<e.length;o+=2)t.push(parseInt(e.substring(o,o+2),16));return t},goog.crypt.stringToUtf8ByteArray=function(e){for(var t=[],o=0,r=0;r<e.length;r++){var s=e.charCodeAt(r);128>s?t[o++]=s:(2048>s?t[o++]=s>>6|192:(55296==(64512&s)&&r+1<e.length&&56320==(64512&e.charCodeAt(r+1))?(s=65536+((1023&s)<<10)+(1023&e.charCodeAt(++r)),t[o++]=s>>18|240,t[o++]=s>>12&63|128):t[o++]=s>>12|224,t[o++]=s>>6&63|128),t[o++]=63&s|128);}return t},goog.crypt.utf8ByteArrayToString=function(e){for(var t=[],o=0,r=0;o<e.length;){var s=e[o++];if(128>s)t[r++]=String.fromCharCode(s);else if(191<s&&224>s){var n=e[o++];t[r++]=String.fromCharCode((31&s)<<6|63&n);}else if(239<s&&365>s){n=e[o++];var i=e[o++];s=((7&s)<<18|(63&n)<<12|(63&i)<<6|63&e[o++])-65536,t[r++]=String.fromCharCode(55296+(s>>10)),t[r++]=String.fromCharCode(56320+(1023&s));}else n=e[o++],i=e[o++],t[r++]=String.fromCharCode((15&s)<<12|(63&n)<<6|63&i);}return t.join("")},goog.crypt.xorByteArray=function(e,t){goog.asserts.assert(e.length==t.length,"XOR array lengths must match");for(var o=[],r=0;r<e.length;r++)o.push(e[r]^t[r]);return o},goog.string={},goog.string.internal={},goog.string.internal.startsWith=function(e,t){return 0==e.lastIndexOf(t,0)},goog.string.internal.endsWith=function(e,t){var o=e.length-t.length;return 0<=o&&e.indexOf(t,o)==o},goog.string.internal.caseInsensitiveStartsWith=function(e,t){return 0==goog.string.internal.caseInsensitiveCompare(t,e.substr(0,t.length))},goog.string.internal.caseInsensitiveEndsWith=function(e,t){return 0==goog.string.internal.caseInsensitiveCompare(t,e.substr(e.length-t.length,t.length))},goog.string.internal.caseInsensitiveEquals=function(e,t){return e.toLowerCase()==t.toLowerCase()},goog.string.internal.isEmptyOrWhitespace=function(e){return /^[\s\xa0]*$/.test(e)},goog.string.internal.trim=goog.TRUSTED_SITE&&String.prototype.trim?function(e){return e.trim()}:function(e){return /^[\s\xa0]*([\s\S]*?)[\s\xa0]*$/.exec(e)[1]},goog.string.internal.caseInsensitiveCompare=function(e,t){return (e=String(e).toLowerCase())<(t=String(t).toLowerCase())?-1:e==t?0:1},goog.string.internal.newLineToBr=function(e,t){return e.replace(/(\r\n|\r|\n)/g,t?"<br />":"<br>")},goog.string.internal.htmlEscape=function(e,t){if(t)e=e.replace(goog.string.internal.AMP_RE_,"&amp;").replace(goog.string.internal.LT_RE_,"&lt;").replace(goog.string.internal.GT_RE_,"&gt;").replace(goog.string.internal.QUOT_RE_,"&quot;").replace(goog.string.internal.SINGLE_QUOTE_RE_,"&#39;").replace(goog.string.internal.NULL_RE_,"&#0;");else {if(!goog.string.internal.ALL_RE_.test(e))return e;-1!=e.indexOf("&")&&(e=e.replace(goog.string.internal.AMP_RE_,"&amp;")),-1!=e.indexOf("<")&&(e=e.replace(goog.string.internal.LT_RE_,"&lt;")),-1!=e.indexOf(">")&&(e=e.replace(goog.string.internal.GT_RE_,"&gt;")),-1!=e.indexOf('"')&&(e=e.replace(goog.string.internal.QUOT_RE_,"&quot;")),-1!=e.indexOf("'")&&(e=e.replace(goog.string.internal.SINGLE_QUOTE_RE_,"&#39;")),-1!=e.indexOf("\0")&&(e=e.replace(goog.string.internal.NULL_RE_,"&#0;"));}return e},goog.string.internal.AMP_RE_=/&/g,goog.string.internal.LT_RE_=/</g,goog.string.internal.GT_RE_=/>/g,goog.string.internal.QUOT_RE_=/"/g,goog.string.internal.SINGLE_QUOTE_RE_=/'/g,goog.string.internal.NULL_RE_=/\x00/g,goog.string.internal.ALL_RE_=/[\x00&<>"']/,goog.string.internal.whitespaceEscape=function(e,t){return goog.string.internal.newLineToBr(e.replace(/  /g," &#160;"),t)},goog.string.internal.contains=function(e,t){return -1!=e.indexOf(t)},goog.string.internal.caseInsensitiveContains=function(e,t){return goog.string.internal.contains(e.toLowerCase(),t.toLowerCase())},goog.string.internal.compareVersions=function(e,t){var o=0;e=goog.string.internal.trim(String(e)).split("."),t=goog.string.internal.trim(String(t)).split(".");for(var r=Math.max(e.length,t.length),s=0;0==o&&s<r;s++){var n=e[s]||"",i=t[s]||"";do{if(n=/(\d*)(\D*)(.*)/.exec(n)||["","","",""],i=/(\d*)(\D*)(.*)/.exec(i)||["","","",""],0==n[0].length&&0==i[0].length)break;o=0==n[1].length?0:parseInt(n[1],10);var a=0==i[1].length?0:parseInt(i[1],10);o=goog.string.internal.compareElements_(o,a)||goog.string.internal.compareElements_(0==n[2].length,0==i[2].length)||goog.string.internal.compareElements_(n[2],i[2]),n=n[3],i=i[3];}while(0==o)}return o},goog.string.internal.compareElements_=function(e,t){return e<t?-1:e>t?1:0},goog.string.TypedString=function(){},goog.string.Const=function(e,t){this.stringConstValueWithSecurityContract__googStringSecurityPrivate_=e===goog.string.Const.GOOG_STRING_CONSTRUCTOR_TOKEN_PRIVATE_&&t||"",this.STRING_CONST_TYPE_MARKER__GOOG_STRING_SECURITY_PRIVATE_=goog.string.Const.TYPE_MARKER_;},goog.string.Const.prototype.implementsGoogStringTypedString=!0,goog.string.Const.prototype.getTypedStringValue=function(){return this.stringConstValueWithSecurityContract__googStringSecurityPrivate_},goog.string.Const.prototype.toString=function(){return "Const{"+this.stringConstValueWithSecurityContract__googStringSecurityPrivate_+"}"},goog.string.Const.unwrap=function(e){return e instanceof goog.string.Const&&e.constructor===goog.string.Const&&e.STRING_CONST_TYPE_MARKER__GOOG_STRING_SECURITY_PRIVATE_===goog.string.Const.TYPE_MARKER_?e.stringConstValueWithSecurityContract__googStringSecurityPrivate_:(goog.asserts.fail("expected object of type Const, got '"+e+"'"),"type_error:Const")},goog.string.Const.from=function(e){return new goog.string.Const(goog.string.Const.GOOG_STRING_CONSTRUCTOR_TOKEN_PRIVATE_,e)},goog.string.Const.TYPE_MARKER_={},goog.string.Const.GOOG_STRING_CONSTRUCTOR_TOKEN_PRIVATE_={},goog.string.Const.EMPTY=goog.string.Const.from(""),goog.fs={},goog.fs.url={},goog.fs.url.createObjectUrl=function(e){return goog.fs.url.getUrlObject_().createObjectURL(e)},goog.fs.url.revokeObjectUrl=function(e){goog.fs.url.getUrlObject_().revokeObjectURL(e);},goog.fs.url.getUrlObject_=function(){var e=goog.fs.url.findUrlObject_();if(null!=e)return e;throw Error("This browser doesn't seem to support blob URLs")},goog.fs.url.findUrlObject_=function(){return goog.isDef(goog.global.URL)&&goog.isDef(goog.global.URL.createObjectURL)?goog.global.URL:goog.isDef(goog.global.webkitURL)&&goog.isDef(goog.global.webkitURL.createObjectURL)?goog.global.webkitURL:goog.isDef(goog.global.createObjectURL)?goog.global:null},goog.fs.url.browserSupportsObjectUrls=function(){return null!=goog.fs.url.findUrlObject_()},goog.html={},goog.html.trustedtypes={},goog.html.trustedtypes.PRIVATE_DO_NOT_ACCESS_OR_ELSE_POLICY=goog.TRUSTED_TYPES_POLICY_NAME?goog.createTrustedTypesPolicy(goog.TRUSTED_TYPES_POLICY_NAME+"#html"):null,goog.i18n={},goog.i18n.bidi={},goog.i18n.bidi.FORCE_RTL=!1,goog.i18n.bidi.IS_RTL=goog.i18n.bidi.FORCE_RTL||("ar"==goog.LOCALE.substring(0,2).toLowerCase()||"fa"==goog.LOCALE.substring(0,2).toLowerCase()||"he"==goog.LOCALE.substring(0,2).toLowerCase()||"iw"==goog.LOCALE.substring(0,2).toLowerCase()||"ps"==goog.LOCALE.substring(0,2).toLowerCase()||"sd"==goog.LOCALE.substring(0,2).toLowerCase()||"ug"==goog.LOCALE.substring(0,2).toLowerCase()||"ur"==goog.LOCALE.substring(0,2).toLowerCase()||"yi"==goog.LOCALE.substring(0,2).toLowerCase())&&(2==goog.LOCALE.length||"-"==goog.LOCALE.substring(2,3)||"_"==goog.LOCALE.substring(2,3))||3<=goog.LOCALE.length&&"ckb"==goog.LOCALE.substring(0,3).toLowerCase()&&(3==goog.LOCALE.length||"-"==goog.LOCALE.substring(3,4)||"_"==goog.LOCALE.substring(3,4))||7<=goog.LOCALE.length&&("-"==goog.LOCALE.substring(2,3)||"_"==goog.LOCALE.substring(2,3))&&("adlm"==goog.LOCALE.substring(3,7).toLowerCase()||"arab"==goog.LOCALE.substring(3,7).toLowerCase()||"hebr"==goog.LOCALE.substring(3,7).toLowerCase()||"nkoo"==goog.LOCALE.substring(3,7).toLowerCase()||"rohg"==goog.LOCALE.substring(3,7).toLowerCase()||"thaa"==goog.LOCALE.substring(3,7).toLowerCase())||8<=goog.LOCALE.length&&("-"==goog.LOCALE.substring(3,4)||"_"==goog.LOCALE.substring(3,4))&&("adlm"==goog.LOCALE.substring(4,8).toLowerCase()||"arab"==goog.LOCALE.substring(4,8).toLowerCase()||"hebr"==goog.LOCALE.substring(4,8).toLowerCase()||"nkoo"==goog.LOCALE.substring(4,8).toLowerCase()||"rohg"==goog.LOCALE.substring(4,8).toLowerCase()||"thaa"==goog.LOCALE.substring(4,8).toLowerCase()),goog.i18n.bidi.Format={LRE:"‪",RLE:"‫",PDF:"‬",LRM:"‎",RLM:"‏"},goog.i18n.bidi.Dir={LTR:1,RTL:-1,NEUTRAL:0},goog.i18n.bidi.RIGHT="right",goog.i18n.bidi.LEFT="left",goog.i18n.bidi.I18N_RIGHT=goog.i18n.bidi.IS_RTL?goog.i18n.bidi.LEFT:goog.i18n.bidi.RIGHT,goog.i18n.bidi.I18N_LEFT=goog.i18n.bidi.IS_RTL?goog.i18n.bidi.RIGHT:goog.i18n.bidi.LEFT,goog.i18n.bidi.toDir=function(e,t){return "number"==typeof e?0<e?goog.i18n.bidi.Dir.LTR:0>e?goog.i18n.bidi.Dir.RTL:t?null:goog.i18n.bidi.Dir.NEUTRAL:null==e?null:e?goog.i18n.bidi.Dir.RTL:goog.i18n.bidi.Dir.LTR},goog.i18n.bidi.ltrChars_="A-Za-zÀ-ÖØ-öø-ʸ̀-֐ऀ-῿‎Ⰰ-\ud801\ud804-\ud839\ud83c-\udbff豈-﬜︀-﹯﻽-￿",goog.i18n.bidi.rtlChars_="֑-ۯۺ-ࣿ‏\ud802-\ud803\ud83a-\ud83bיִ-﷿ﹰ-ﻼ",goog.i18n.bidi.htmlSkipReg_=/<[^>]*>|&[^;]+;/g,goog.i18n.bidi.stripHtmlIfNeeded_=function(e,t){return t?e.replace(goog.i18n.bidi.htmlSkipReg_,""):e},goog.i18n.bidi.rtlCharReg_=new RegExp("["+goog.i18n.bidi.rtlChars_+"]"),goog.i18n.bidi.ltrCharReg_=new RegExp("["+goog.i18n.bidi.ltrChars_+"]"),goog.i18n.bidi.hasAnyRtl=function(e,t){return goog.i18n.bidi.rtlCharReg_.test(goog.i18n.bidi.stripHtmlIfNeeded_(e,t))},goog.i18n.bidi.hasRtlChar=goog.i18n.bidi.hasAnyRtl,goog.i18n.bidi.hasAnyLtr=function(e,t){return goog.i18n.bidi.ltrCharReg_.test(goog.i18n.bidi.stripHtmlIfNeeded_(e,t))},goog.i18n.bidi.ltrRe_=new RegExp("^["+goog.i18n.bidi.ltrChars_+"]"),goog.i18n.bidi.rtlRe_=new RegExp("^["+goog.i18n.bidi.rtlChars_+"]"),goog.i18n.bidi.isRtlChar=function(e){return goog.i18n.bidi.rtlRe_.test(e)},goog.i18n.bidi.isLtrChar=function(e){return goog.i18n.bidi.ltrRe_.test(e)},goog.i18n.bidi.isNeutralChar=function(e){return !goog.i18n.bidi.isLtrChar(e)&&!goog.i18n.bidi.isRtlChar(e)},goog.i18n.bidi.ltrDirCheckRe_=new RegExp("^[^"+goog.i18n.bidi.rtlChars_+"]*["+goog.i18n.bidi.ltrChars_+"]"),goog.i18n.bidi.rtlDirCheckRe_=new RegExp("^[^"+goog.i18n.bidi.ltrChars_+"]*["+goog.i18n.bidi.rtlChars_+"]"),goog.i18n.bidi.startsWithRtl=function(e,t){return goog.i18n.bidi.rtlDirCheckRe_.test(goog.i18n.bidi.stripHtmlIfNeeded_(e,t))},goog.i18n.bidi.isRtlText=goog.i18n.bidi.startsWithRtl,goog.i18n.bidi.startsWithLtr=function(e,t){return goog.i18n.bidi.ltrDirCheckRe_.test(goog.i18n.bidi.stripHtmlIfNeeded_(e,t))},goog.i18n.bidi.isLtrText=goog.i18n.bidi.startsWithLtr,goog.i18n.bidi.isRequiredLtrRe_=/^http:\/\/.*/,goog.i18n.bidi.isNeutralText=function(e,t){return e=goog.i18n.bidi.stripHtmlIfNeeded_(e,t),goog.i18n.bidi.isRequiredLtrRe_.test(e)||!goog.i18n.bidi.hasAnyLtr(e)&&!goog.i18n.bidi.hasAnyRtl(e)},goog.i18n.bidi.ltrExitDirCheckRe_=new RegExp("["+goog.i18n.bidi.ltrChars_+"][^"+goog.i18n.bidi.rtlChars_+"]*$"),goog.i18n.bidi.rtlExitDirCheckRe_=new RegExp("["+goog.i18n.bidi.rtlChars_+"][^"+goog.i18n.bidi.ltrChars_+"]*$"),goog.i18n.bidi.endsWithLtr=function(e,t){return goog.i18n.bidi.ltrExitDirCheckRe_.test(goog.i18n.bidi.stripHtmlIfNeeded_(e,t))},goog.i18n.bidi.isLtrExitText=goog.i18n.bidi.endsWithLtr,goog.i18n.bidi.endsWithRtl=function(e,t){return goog.i18n.bidi.rtlExitDirCheckRe_.test(goog.i18n.bidi.stripHtmlIfNeeded_(e,t))},goog.i18n.bidi.isRtlExitText=goog.i18n.bidi.endsWithRtl,goog.i18n.bidi.rtlLocalesRe_=/^(ar|ckb|dv|he|iw|fa|nqo|ps|sd|ug|ur|yi|.*[-_](Adlm|Arab|Hebr|Nkoo|Rohg|Thaa))(?!.*[-_](Latn|Cyrl)($|-|_))($|-|_)/i,goog.i18n.bidi.isRtlLanguage=function(e){return goog.i18n.bidi.rtlLocalesRe_.test(e)},goog.i18n.bidi.bracketGuardTextRe_=/(\(.*?\)+)|(\[.*?\]+)|(\{.*?\}+)|(<.*?>+)/g,goog.i18n.bidi.guardBracketInText=function(e,t){return t=(void 0===t?goog.i18n.bidi.hasAnyRtl(e):t)?goog.i18n.bidi.Format.RLM:goog.i18n.bidi.Format.LRM,e.replace(goog.i18n.bidi.bracketGuardTextRe_,t+"$&"+t)},goog.i18n.bidi.enforceRtlInHtml=function(e){return "<"==e.charAt(0)?e.replace(/<\w+/,"$& dir=rtl"):"\n<span dir=rtl>"+e+"</span>"},goog.i18n.bidi.enforceRtlInText=function(e){return goog.i18n.bidi.Format.RLE+e+goog.i18n.bidi.Format.PDF},goog.i18n.bidi.enforceLtrInHtml=function(e){return "<"==e.charAt(0)?e.replace(/<\w+/,"$& dir=ltr"):"\n<span dir=ltr>"+e+"</span>"},goog.i18n.bidi.enforceLtrInText=function(e){return goog.i18n.bidi.Format.LRE+e+goog.i18n.bidi.Format.PDF},goog.i18n.bidi.dimensionsRe_=/:\s*([.\d][.\w]*)\s+([.\d][.\w]*)\s+([.\d][.\w]*)\s+([.\d][.\w]*)/g,goog.i18n.bidi.leftRe_=/left/gi,goog.i18n.bidi.rightRe_=/right/gi,goog.i18n.bidi.tempRe_=/%%%%/g,goog.i18n.bidi.mirrorCSS=function(e){return e.replace(goog.i18n.bidi.dimensionsRe_,":$1 $4 $3 $2").replace(goog.i18n.bidi.leftRe_,"%%%%").replace(goog.i18n.bidi.rightRe_,goog.i18n.bidi.LEFT).replace(goog.i18n.bidi.tempRe_,goog.i18n.bidi.RIGHT)},goog.i18n.bidi.doubleQuoteSubstituteRe_=/([\u0591-\u05f2])"/g,goog.i18n.bidi.singleQuoteSubstituteRe_=/([\u0591-\u05f2])'/g,goog.i18n.bidi.normalizeHebrewQuote=function(e){return e.replace(goog.i18n.bidi.doubleQuoteSubstituteRe_,"$1״").replace(goog.i18n.bidi.singleQuoteSubstituteRe_,"$1׳")},goog.i18n.bidi.wordSeparatorRe_=/\s+/,goog.i18n.bidi.hasNumeralsRe_=/[\d\u06f0-\u06f9]/,goog.i18n.bidi.rtlDetectionThreshold_=.4,goog.i18n.bidi.estimateDirection=function(e,t){var o=0,r=0,s=!1;for(e=goog.i18n.bidi.stripHtmlIfNeeded_(e,t).split(goog.i18n.bidi.wordSeparatorRe_),t=0;t<e.length;t++){var n=e[t];goog.i18n.bidi.startsWithRtl(n)?(o++,r++):goog.i18n.bidi.isRequiredLtrRe_.test(n)?s=!0:goog.i18n.bidi.hasAnyLtr(n)?r++:goog.i18n.bidi.hasNumeralsRe_.test(n)&&(s=!0);}return 0==r?s?goog.i18n.bidi.Dir.LTR:goog.i18n.bidi.Dir.NEUTRAL:o/r>goog.i18n.bidi.rtlDetectionThreshold_?goog.i18n.bidi.Dir.RTL:goog.i18n.bidi.Dir.LTR},goog.i18n.bidi.detectRtlDirectionality=function(e,t){return goog.i18n.bidi.estimateDirection(e,t)==goog.i18n.bidi.Dir.RTL},goog.i18n.bidi.setElementDirAndAlign=function(e,t){e&&(t=goog.i18n.bidi.toDir(t))&&(e.style.textAlign=t==goog.i18n.bidi.Dir.RTL?goog.i18n.bidi.RIGHT:goog.i18n.bidi.LEFT,e.dir=t==goog.i18n.bidi.Dir.RTL?"rtl":"ltr");},goog.i18n.bidi.setElementDirByTextDirectionality=function(e,t){switch(goog.i18n.bidi.estimateDirection(t)){case goog.i18n.bidi.Dir.LTR:e.dir="ltr";break;case goog.i18n.bidi.Dir.RTL:e.dir="rtl";break;default:e.removeAttribute("dir");}},goog.i18n.bidi.DirectionalString=function(){},goog.html.TrustedResourceUrl=function(){this.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue_="",this.trustedURL_=null,this.TRUSTED_RESOURCE_URL_TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_=goog.html.TrustedResourceUrl.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_;},goog.html.TrustedResourceUrl.prototype.implementsGoogStringTypedString=!0,goog.html.TrustedResourceUrl.prototype.getTypedStringValue=function(){return this.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue_.toString()},goog.html.TrustedResourceUrl.prototype.implementsGoogI18nBidiDirectionalString=!0,goog.html.TrustedResourceUrl.prototype.getDirection=function(){return goog.i18n.bidi.Dir.LTR},goog.html.TrustedResourceUrl.prototype.cloneWithParams=function(e,t){var o=goog.html.TrustedResourceUrl.unwrap(this),r=(o=goog.html.TrustedResourceUrl.URL_PARAM_PARSER_.exec(o))[3]||"";return goog.html.TrustedResourceUrl.createTrustedResourceUrlSecurityPrivateDoNotAccessOrElse(o[1]+goog.html.TrustedResourceUrl.stringifyParams_("?",o[2]||"",e)+goog.html.TrustedResourceUrl.stringifyParams_("#",r,t))},goog.DEBUG&&(goog.html.TrustedResourceUrl.prototype.toString=function(){return "TrustedResourceUrl{"+this.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue_+"}"}),goog.html.TrustedResourceUrl.unwrap=function(e){return goog.html.TrustedResourceUrl.unwrapTrustedScriptURL(e).toString()},goog.html.TrustedResourceUrl.unwrapTrustedScriptURL=function(e){return e instanceof goog.html.TrustedResourceUrl&&e.constructor===goog.html.TrustedResourceUrl&&e.TRUSTED_RESOURCE_URL_TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_===goog.html.TrustedResourceUrl.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_?e.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue_:(goog.asserts.fail("expected object of type TrustedResourceUrl, got '"+e+"' of type "+goog.typeOf(e)),"type_error:TrustedResourceUrl")},goog.html.TrustedResourceUrl.unwrapTrustedURL=function(e){return e.trustedURL_?e.trustedURL_:goog.html.TrustedResourceUrl.unwrap(e)},goog.html.TrustedResourceUrl.format=function(e,t){var o=goog.string.Const.unwrap(e);if(!goog.html.TrustedResourceUrl.BASE_URL_.test(o))throw Error("Invalid TrustedResourceUrl format: "+o);return e=o.replace(goog.html.TrustedResourceUrl.FORMAT_MARKER_,(function(e,r){if(!Object.prototype.hasOwnProperty.call(t,r))throw Error('Found marker, "'+r+'", in format string, "'+o+'", but no valid label mapping found in args: '+JSON.stringify(t));return (e=t[r])instanceof goog.string.Const?goog.string.Const.unwrap(e):encodeURIComponent(String(e))})),goog.html.TrustedResourceUrl.createTrustedResourceUrlSecurityPrivateDoNotAccessOrElse(e)},goog.html.TrustedResourceUrl.FORMAT_MARKER_=/%{(\w+)}/g,goog.html.TrustedResourceUrl.BASE_URL_=/^((https:)?\/\/[0-9a-z.:[\]-]+\/|\/[^/\\]|[^:/\\%]+\/|[^:/\\%]*[?#]|about:blank#)/i,goog.html.TrustedResourceUrl.URL_PARAM_PARSER_=/^([^?#]*)(\?[^#]*)?(#[\s\S]*)?/,goog.html.TrustedResourceUrl.formatWithParams=function(e,t,o,r){return goog.html.TrustedResourceUrl.format(e,t).cloneWithParams(o,r)},goog.html.TrustedResourceUrl.fromConstant=function(e){return goog.html.TrustedResourceUrl.createTrustedResourceUrlSecurityPrivateDoNotAccessOrElse(goog.string.Const.unwrap(e))},goog.html.TrustedResourceUrl.fromConstants=function(e){for(var t="",o=0;o<e.length;o++)t+=goog.string.Const.unwrap(e[o]);return goog.html.TrustedResourceUrl.createTrustedResourceUrlSecurityPrivateDoNotAccessOrElse(t)},goog.html.TrustedResourceUrl.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_={},goog.html.TrustedResourceUrl.createTrustedResourceUrlSecurityPrivateDoNotAccessOrElse=function(e){var t=new goog.html.TrustedResourceUrl;return t.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue_=goog.html.trustedtypes.PRIVATE_DO_NOT_ACCESS_OR_ELSE_POLICY?goog.html.trustedtypes.PRIVATE_DO_NOT_ACCESS_OR_ELSE_POLICY.createScriptURL(e):e,goog.html.trustedtypes.PRIVATE_DO_NOT_ACCESS_OR_ELSE_POLICY&&(t.trustedURL_=goog.html.trustedtypes.PRIVATE_DO_NOT_ACCESS_OR_ELSE_POLICY.createURL(e)),t},goog.html.TrustedResourceUrl.stringifyParams_=function(e,t,o){if(null==o)return t;if(goog.isString(o))return o?e+encodeURIComponent(o):"";for(var r in o){var s=o[r];s=goog.isArray(s)?s:[s];for(var n=0;n<s.length;n++){var i=s[n];null!=i&&(t||(t=e),t+=(t.length>e.length?"&":"")+encodeURIComponent(r)+"="+encodeURIComponent(String(i)));}}return t},goog.html.SafeUrl=function(){this.privateDoNotAccessOrElseSafeUrlWrappedValue_="",this.SAFE_URL_TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_=goog.html.SafeUrl.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_;},goog.html.SafeUrl.INNOCUOUS_STRING="about:invalid#zClosurez",goog.html.SafeUrl.prototype.implementsGoogStringTypedString=!0,goog.html.SafeUrl.prototype.getTypedStringValue=function(){return this.privateDoNotAccessOrElseSafeUrlWrappedValue_.toString()},goog.html.SafeUrl.prototype.implementsGoogI18nBidiDirectionalString=!0,goog.html.SafeUrl.prototype.getDirection=function(){return goog.i18n.bidi.Dir.LTR},goog.DEBUG&&(goog.html.SafeUrl.prototype.toString=function(){return "SafeUrl{"+this.privateDoNotAccessOrElseSafeUrlWrappedValue_+"}"}),goog.html.SafeUrl.unwrap=function(e){return goog.html.SafeUrl.unwrapTrustedURL(e).toString()},goog.html.SafeUrl.unwrapTrustedURL=function(e){return e instanceof goog.html.SafeUrl&&e.constructor===goog.html.SafeUrl&&e.SAFE_URL_TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_===goog.html.SafeUrl.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_?e.privateDoNotAccessOrElseSafeUrlWrappedValue_:(goog.asserts.fail("expected object of type SafeUrl, got '"+e+"' of type "+goog.typeOf(e)),"type_error:SafeUrl")},goog.html.SafeUrl.fromConstant=function(e){return goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(goog.string.Const.unwrap(e))},goog.html.SAFE_MIME_TYPE_PATTERN_=/^(?:audio\/(?:3gpp2|3gpp|aac|L16|midi|mp3|mp4|mpeg|oga|ogg|opus|x-m4a|x-wav|wav|webm)|image\/(?:bmp|gif|jpeg|jpg|png|tiff|webp|x-icon)|text\/csv|video\/(?:mpeg|mp4|ogg|webm|quicktime))(?:;\w+=(?:\w+|"[\w;=]+"))*$/i,goog.html.SafeUrl.isSafeMimeType=function(e){return goog.html.SAFE_MIME_TYPE_PATTERN_.test(e)},goog.html.SafeUrl.fromBlob=function(e){return e=goog.html.SAFE_MIME_TYPE_PATTERN_.test(e.type)?goog.fs.url.createObjectUrl(e):goog.html.SafeUrl.INNOCUOUS_STRING,goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(e)},goog.html.DATA_URL_PATTERN_=/^data:([^,]*);base64,[a-z0-9+\/]+=*$/i,goog.html.SafeUrl.fromDataUrl=function(e){var t=(e=e.replace(/(%0A|%0D)/g,"")).match(goog.html.DATA_URL_PATTERN_);return t=t&&goog.html.SAFE_MIME_TYPE_PATTERN_.test(t[1]),goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(t?e:goog.html.SafeUrl.INNOCUOUS_STRING)},goog.html.SafeUrl.fromTelUrl=function(e){return goog.string.internal.caseInsensitiveStartsWith(e,"tel:")||(e=goog.html.SafeUrl.INNOCUOUS_STRING),goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(e)},goog.html.SIP_URL_PATTERN_=/^sip[s]?:[+a-z0-9_.!$%&'*\/=^`{|}~-]+@([a-z0-9-]+\.)+[a-z0-9]{2,63}$/i,goog.html.SafeUrl.fromSipUrl=function(e){return goog.html.SIP_URL_PATTERN_.test(decodeURIComponent(e))||(e=goog.html.SafeUrl.INNOCUOUS_STRING),goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(e)},goog.html.SafeUrl.fromFacebookMessengerUrl=function(e){return goog.string.internal.caseInsensitiveStartsWith(e,"fb-messenger://share")||(e=goog.html.SafeUrl.INNOCUOUS_STRING),goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(e)},goog.html.SafeUrl.fromWhatsAppUrl=function(e){return goog.string.internal.caseInsensitiveStartsWith(e,"whatsapp://send")||(e=goog.html.SafeUrl.INNOCUOUS_STRING),goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(e)},goog.html.SafeUrl.fromSmsUrl=function(e){return goog.string.internal.caseInsensitiveStartsWith(e,"sms:")&&goog.html.SafeUrl.isSmsUrlBodyValid_(e)||(e=goog.html.SafeUrl.INNOCUOUS_STRING),goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(e)},goog.html.SafeUrl.isSmsUrlBodyValid_=function(e){var t=e.indexOf("#");if(0<t&&(e=e.substring(0,t)),!(t=e.match(/[?&]body=/gi)))return !0;if(1<t.length)return !1;if(!(e=e.match(/[?&]body=([^&]*)/)[1]))return !0;try{decodeURIComponent(e);}catch(e){return !1}return /^(?:[a-z0-9\-_.~]|%[0-9a-f]{2})+$/i.test(e)},goog.html.SafeUrl.fromSshUrl=function(e){return goog.string.internal.caseInsensitiveStartsWith(e,"ssh://")||(e=goog.html.SafeUrl.INNOCUOUS_STRING),goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(e)},goog.html.SafeUrl.sanitizeChromeExtensionUrl=function(e,t){return goog.html.SafeUrl.sanitizeExtensionUrl_(/^chrome-extension:\/\/([^\/]+)\//,e,t)},goog.html.SafeUrl.sanitizeFirefoxExtensionUrl=function(e,t){return goog.html.SafeUrl.sanitizeExtensionUrl_(/^moz-extension:\/\/([^\/]+)\//,e,t)},goog.html.SafeUrl.sanitizeEdgeExtensionUrl=function(e,t){return goog.html.SafeUrl.sanitizeExtensionUrl_(/^ms-browser-extension:\/\/([^\/]+)\//,e,t)},goog.html.SafeUrl.sanitizeExtensionUrl_=function(e,t,o){return (e=e.exec(t))?(e=e[1],-1==(o instanceof goog.string.Const?[goog.string.Const.unwrap(o)]:o.map((function(e){return goog.string.Const.unwrap(e)}))).indexOf(e)&&(t=goog.html.SafeUrl.INNOCUOUS_STRING)):t=goog.html.SafeUrl.INNOCUOUS_STRING,goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(t)},goog.html.SafeUrl.fromTrustedResourceUrl=function(e){return goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(goog.html.TrustedResourceUrl.unwrap(e))},goog.html.SAFE_URL_PATTERN_=/^(?:(?:https?|mailto|ftp):|[^:/?#]*(?:[/?#]|$))/i,goog.html.SafeUrl.SAFE_URL_PATTERN=goog.html.SAFE_URL_PATTERN_,goog.html.SafeUrl.sanitize=function(e){return e instanceof goog.html.SafeUrl?e:(e="object"==typeof e&&e.implementsGoogStringTypedString?e.getTypedStringValue():String(e),goog.html.SAFE_URL_PATTERN_.test(e)||(e=goog.html.SafeUrl.INNOCUOUS_STRING),goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(e))},goog.html.SafeUrl.sanitizeAssertUnchanged=function(e,t){return e instanceof goog.html.SafeUrl?e:(e="object"==typeof e&&e.implementsGoogStringTypedString?e.getTypedStringValue():String(e),t&&/^data:/i.test(e)&&(t=goog.html.SafeUrl.fromDataUrl(e)).getTypedStringValue()==e?t:(goog.asserts.assert(goog.html.SAFE_URL_PATTERN_.test(e),"%s does not match the safe URL pattern",e)||(e=goog.html.SafeUrl.INNOCUOUS_STRING),goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(e)))},goog.html.SafeUrl.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_={},goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse=function(e){var t=new goog.html.SafeUrl;return t.privateDoNotAccessOrElseSafeUrlWrappedValue_=goog.html.trustedtypes.PRIVATE_DO_NOT_ACCESS_OR_ELSE_POLICY?goog.html.trustedtypes.PRIVATE_DO_NOT_ACCESS_OR_ELSE_POLICY.createURL(e):e,t},goog.html.SafeUrl.ABOUT_BLANK=goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse("about:blank"),goog.html.SafeStyle=function(){this.privateDoNotAccessOrElseSafeStyleWrappedValue_="",this.SAFE_STYLE_TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_=goog.html.SafeStyle.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_;},goog.html.SafeStyle.prototype.implementsGoogStringTypedString=!0,goog.html.SafeStyle.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_={},goog.html.SafeStyle.fromConstant=function(e){return 0===(e=goog.string.Const.unwrap(e)).length?goog.html.SafeStyle.EMPTY:(goog.asserts.assert(goog.string.internal.endsWith(e,";"),"Last character of style string is not ';': "+e),goog.asserts.assert(goog.string.internal.contains(e,":"),"Style string must contain at least one ':', to specify a \"name: value\" pair: "+e),goog.html.SafeStyle.createSafeStyleSecurityPrivateDoNotAccessOrElse(e))},goog.html.SafeStyle.prototype.getTypedStringValue=function(){return this.privateDoNotAccessOrElseSafeStyleWrappedValue_},goog.DEBUG&&(goog.html.SafeStyle.prototype.toString=function(){return "SafeStyle{"+this.privateDoNotAccessOrElseSafeStyleWrappedValue_+"}"}),goog.html.SafeStyle.unwrap=function(e){return e instanceof goog.html.SafeStyle&&e.constructor===goog.html.SafeStyle&&e.SAFE_STYLE_TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_===goog.html.SafeStyle.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_?e.privateDoNotAccessOrElseSafeStyleWrappedValue_:(goog.asserts.fail("expected object of type SafeStyle, got '"+e+"' of type "+goog.typeOf(e)),"type_error:SafeStyle")},goog.html.SafeStyle.createSafeStyleSecurityPrivateDoNotAccessOrElse=function(e){return (new goog.html.SafeStyle).initSecurityPrivateDoNotAccessOrElse_(e)},goog.html.SafeStyle.prototype.initSecurityPrivateDoNotAccessOrElse_=function(e){return this.privateDoNotAccessOrElseSafeStyleWrappedValue_=e,this},goog.html.SafeStyle.EMPTY=goog.html.SafeStyle.createSafeStyleSecurityPrivateDoNotAccessOrElse(""),goog.html.SafeStyle.INNOCUOUS_STRING="zClosurez",goog.html.SafeStyle.create=function(e){var t,o="";for(t in e){if(!/^[-_a-zA-Z0-9]+$/.test(t))throw Error("Name allows only [-_a-zA-Z0-9], got: "+t);var r=e[t];null!=r&&(o+=t+":"+(r=goog.isArray(r)?goog.array.map(r,goog.html.SafeStyle.sanitizePropertyValue_).join(" "):goog.html.SafeStyle.sanitizePropertyValue_(r))+";");}return o?goog.html.SafeStyle.createSafeStyleSecurityPrivateDoNotAccessOrElse(o):goog.html.SafeStyle.EMPTY},goog.html.SafeStyle.sanitizePropertyValue_=function(e){if(e instanceof goog.html.SafeUrl)return 'url("'+goog.html.SafeUrl.unwrap(e).replace(/</g,"%3c").replace(/[\\"]/g,"\\$&")+'")';if(e=e instanceof goog.string.Const?goog.string.Const.unwrap(e):goog.html.SafeStyle.sanitizePropertyValueString_(String(e)),/[{;}]/.test(e))throw new goog.asserts.AssertionError("Value does not allow [{;}], got: %s.",[e]);return e},goog.html.SafeStyle.sanitizePropertyValueString_=function(e){var t=e.replace(goog.html.SafeStyle.FUNCTIONS_RE_,"$1").replace(goog.html.SafeStyle.FUNCTIONS_RE_,"$1").replace(goog.html.SafeStyle.URL_RE_,"url");return goog.html.SafeStyle.VALUE_RE_.test(t)?goog.html.SafeStyle.COMMENT_RE_.test(e)?(goog.asserts.fail("String value disallows comments, got: "+e),goog.html.SafeStyle.INNOCUOUS_STRING):goog.html.SafeStyle.hasBalancedQuotes_(e)?goog.html.SafeStyle.hasBalancedSquareBrackets_(e)?goog.html.SafeStyle.sanitizeUrl_(e):(goog.asserts.fail("String value requires balanced square brackets and one identifier per pair of brackets, got: "+e),goog.html.SafeStyle.INNOCUOUS_STRING):(goog.asserts.fail("String value requires balanced quotes, got: "+e),goog.html.SafeStyle.INNOCUOUS_STRING):(goog.asserts.fail("String value allows only "+goog.html.SafeStyle.VALUE_ALLOWED_CHARS_+" and simple functions, got: "+e),goog.html.SafeStyle.INNOCUOUS_STRING)},goog.html.SafeStyle.hasBalancedQuotes_=function(e){for(var t=!0,o=!0,r=0;r<e.length;r++){var s=e.charAt(r);"'"==s&&o?t=!t:'"'==s&&t&&(o=!o);}return t&&o},goog.html.SafeStyle.hasBalancedSquareBrackets_=function(e){for(var t=!0,o=/^[-_a-zA-Z0-9]$/,r=0;r<e.length;r++){var s=e.charAt(r);if("]"==s){if(t)return !1;t=!0;}else if("["==s){if(!t)return !1;t=!1;}else if(!t&&!o.test(s))return !1}return t},goog.html.SafeStyle.VALUE_ALLOWED_CHARS_="[-,.\"'%_!# a-zA-Z0-9\\[\\]]",goog.html.SafeStyle.VALUE_RE_=new RegExp("^"+goog.html.SafeStyle.VALUE_ALLOWED_CHARS_+"+$"),goog.html.SafeStyle.URL_RE_=/\b(url\([ \t\n]*)('[ -&(-\[\]-~]*'|"[ !#-\[\]-~]*"|[!#-&*-\[\]-~]*)([ \t\n]*\))/g,goog.html.SafeStyle.FUNCTIONS_RE_=/\b(hsl|hsla|rgb|rgba|matrix|calc|minmax|fit-content|repeat|(rotate|scale|translate)(X|Y|Z|3d)?)\([-+*/0-9a-z.%\[\], ]+\)/g,goog.html.SafeStyle.COMMENT_RE_=/\/\*/,goog.html.SafeStyle.sanitizeUrl_=function(e){return e.replace(goog.html.SafeStyle.URL_RE_,(function(e,t,o,r){var s="";return o=o.replace(/^(['"])(.*)\1$/,(function(e,t,o){return s=t,o})),e=goog.html.SafeUrl.sanitize(o).getTypedStringValue(),t+s+e+s+r}))},goog.html.SafeStyle.concat=function(e){var t="",o=function(e){goog.isArray(e)?goog.array.forEach(e,o):t+=goog.html.SafeStyle.unwrap(e);};return goog.array.forEach(arguments,o),t?goog.html.SafeStyle.createSafeStyleSecurityPrivateDoNotAccessOrElse(t):goog.html.SafeStyle.EMPTY},goog.html.SafeScript=function(){this.privateDoNotAccessOrElseSafeScriptWrappedValue_="",this.SAFE_SCRIPT_TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_=goog.html.SafeScript.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_;},goog.html.SafeScript.prototype.implementsGoogStringTypedString=!0,goog.html.SafeScript.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_={},goog.html.SafeScript.fromConstant=function(e){return 0===(e=goog.string.Const.unwrap(e)).length?goog.html.SafeScript.EMPTY:goog.html.SafeScript.createSafeScriptSecurityPrivateDoNotAccessOrElse(e)},goog.html.SafeScript.fromConstantAndArgs=function(e,t){for(var o=[],r=1;r<arguments.length;r++)o.push(goog.html.SafeScript.stringify_(arguments[r]));return goog.html.SafeScript.createSafeScriptSecurityPrivateDoNotAccessOrElse("("+goog.string.Const.unwrap(e)+")("+o.join(", ")+");")},goog.html.SafeScript.fromJson=function(e){return goog.html.SafeScript.createSafeScriptSecurityPrivateDoNotAccessOrElse(goog.html.SafeScript.stringify_(e))},goog.html.SafeScript.prototype.getTypedStringValue=function(){return this.privateDoNotAccessOrElseSafeScriptWrappedValue_.toString()},goog.DEBUG&&(goog.html.SafeScript.prototype.toString=function(){return "SafeScript{"+this.privateDoNotAccessOrElseSafeScriptWrappedValue_+"}"}),goog.html.SafeScript.unwrap=function(e){return goog.html.SafeScript.unwrapTrustedScript(e).toString()},goog.html.SafeScript.unwrapTrustedScript=function(e){return e instanceof goog.html.SafeScript&&e.constructor===goog.html.SafeScript&&e.SAFE_SCRIPT_TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_===goog.html.SafeScript.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_?e.privateDoNotAccessOrElseSafeScriptWrappedValue_:(goog.asserts.fail("expected object of type SafeScript, got '"+e+"' of type "+goog.typeOf(e)),"type_error:SafeScript")},goog.html.SafeScript.stringify_=function(e){return JSON.stringify(e).replace(/</g,"\\x3c")},goog.html.SafeScript.createSafeScriptSecurityPrivateDoNotAccessOrElse=function(e){return (new goog.html.SafeScript).initSecurityPrivateDoNotAccessOrElse_(e)},goog.html.SafeScript.prototype.initSecurityPrivateDoNotAccessOrElse_=function(e){return this.privateDoNotAccessOrElseSafeScriptWrappedValue_=goog.html.trustedtypes.PRIVATE_DO_NOT_ACCESS_OR_ELSE_POLICY?goog.html.trustedtypes.PRIVATE_DO_NOT_ACCESS_OR_ELSE_POLICY.createScript(e):e,this},goog.html.SafeScript.EMPTY=goog.html.SafeScript.createSafeScriptSecurityPrivateDoNotAccessOrElse(""),goog.object={},goog.object.is=function(e,t){return e===t?0!==e||1/e==1/t:e!=e&&t!=t},goog.object.forEach=function(e,t,o){for(var r in e)t.call(o,e[r],r,e);},goog.object.filter=function(e,t,o){var r,s={};for(r in e)t.call(o,e[r],r,e)&&(s[r]=e[r]);return s},goog.object.map=function(e,t,o){var r,s={};for(r in e)s[r]=t.call(o,e[r],r,e);return s},goog.object.some=function(e,t,o){for(var r in e)if(t.call(o,e[r],r,e))return !0;return !1},goog.object.every=function(e,t,o){for(var r in e)if(!t.call(o,e[r],r,e))return !1;return !0},goog.object.getCount=function(e){var t,o=0;for(t in e)o++;return o},goog.object.getAnyKey=function(e){for(var t in e)return t},goog.object.getAnyValue=function(e){for(var t in e)return e[t]},goog.object.contains=function(e,t){return goog.object.containsValue(e,t)},goog.object.getValues=function(e){var t,o=[],r=0;for(t in e)o[r++]=e[t];return o},goog.object.getKeys=function(e){var t,o=[],r=0;for(t in e)o[r++]=t;return o},goog.object.getValueByKeys=function(e,t){var o=goog.isArrayLike(t),r=o?t:arguments;for(o=o?0:1;o<r.length;o++){if(null==e)return;e=e[r[o]];}return e},goog.object.containsKey=function(e,t){return null!==e&&t in e},goog.object.containsValue=function(e,t){for(var o in e)if(e[o]==t)return !0;return !1},goog.object.findKey=function(e,t,o){for(var r in e)if(t.call(o,e[r],r,e))return r},goog.object.findValue=function(e,t,o){return (t=goog.object.findKey(e,t,o))&&e[t]},goog.object.isEmpty=function(e){for(var t in e)return !1;return !0},goog.object.clear=function(e){for(var t in e)delete e[t];},goog.object.remove=function(e,t){var o;return (o=t in e)&&delete e[t],o},goog.object.add=function(e,t,o){if(null!==e&&t in e)throw Error('The object already contains the key "'+t+'"');goog.object.set(e,t,o);},goog.object.get=function(e,t,o){return null!==e&&t in e?e[t]:o},goog.object.set=function(e,t,o){e[t]=o;},goog.object.setIfUndefined=function(e,t,o){return t in e?e[t]:e[t]=o},goog.object.setWithReturnValueIfNotSet=function(e,t,o){return t in e?e[t]:(o=o(),e[t]=o)},goog.object.equals=function(e,t){for(var o in e)if(!(o in t)||e[o]!==t[o])return !1;for(var r in t)if(!(r in e))return !1;return !0},goog.object.clone=function(e){var t,o={};for(t in e)o[t]=e[t];return o},goog.object.unsafeClone=function(e){var t=goog.typeOf(e);if("object"==t||"array"==t){if(goog.isFunction(e.clone))return e.clone();for(var o in t="array"==t?[]:{},e)t[o]=goog.object.unsafeClone(e[o]);return t}return e},goog.object.transpose=function(e){var t,o={};for(t in e)o[e[t]]=t;return o},goog.object.PROTOTYPE_FIELDS_="constructor hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf".split(" "),goog.object.extend=function(e,t){for(var o,r,s=1;s<arguments.length;s++){for(o in r=arguments[s])e[o]=r[o];for(var n=0;n<goog.object.PROTOTYPE_FIELDS_.length;n++)o=goog.object.PROTOTYPE_FIELDS_[n],Object.prototype.hasOwnProperty.call(r,o)&&(e[o]=r[o]);}},goog.object.create=function(e){var t=arguments.length;if(1==t&&goog.isArray(arguments[0]))return goog.object.create.apply(null,arguments[0]);if(t%2)throw Error("Uneven number of arguments");for(var o={},r=0;r<t;r+=2)o[arguments[r]]=arguments[r+1];return o},goog.object.createSet=function(e){var t=arguments.length;if(1==t&&goog.isArray(arguments[0]))return goog.object.createSet.apply(null,arguments[0]);for(var o={},r=0;r<t;r++)o[arguments[r]]=!0;return o},goog.object.createImmutableView=function(e){var t=e;return Object.isFrozen&&!Object.isFrozen(e)&&(t=Object.create(e),Object.freeze(t)),t},goog.object.isImmutableView=function(e){return !!Object.isFrozen&&Object.isFrozen(e)},goog.object.getAllPropertyNames=function(e,t,o){if(!e)return [];if(!Object.getOwnPropertyNames||!Object.getPrototypeOf)return goog.object.getKeys(e);for(var r={};e&&(e!==Object.prototype||t)&&(e!==Function.prototype||o);){for(var s=Object.getOwnPropertyNames(e),n=0;n<s.length;n++)r[s[n]]=!0;e=Object.getPrototypeOf(e);}return goog.object.getKeys(r)},goog.object.getSuperClass=function(e){return (e=Object.getPrototypeOf(e.prototype))&&e.constructor},goog.html.SafeStyleSheet=function(){this.privateDoNotAccessOrElseSafeStyleSheetWrappedValue_="",this.SAFE_STYLE_SHEET_TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_=goog.html.SafeStyleSheet.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_;},goog.html.SafeStyleSheet.prototype.implementsGoogStringTypedString=!0,goog.html.SafeStyleSheet.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_={},goog.html.SafeStyleSheet.createRule=function(e,t){if(goog.string.internal.contains(e,"<"))throw Error("Selector does not allow '<', got: "+e);var o=e.replace(/('|")((?!\1)[^\r\n\f\\]|\\[\s\S])*\1/g,"");if(!/^[-_a-zA-Z0-9#.:* ,>+~[\]()=^$|]+$/.test(o))throw Error("Selector allows only [-_a-zA-Z0-9#.:* ,>+~[\\]()=^$|] and strings, got: "+e);if(!goog.html.SafeStyleSheet.hasBalancedBrackets_(o))throw Error("() and [] in selector must be balanced, got: "+e);return t instanceof goog.html.SafeStyle||(t=goog.html.SafeStyle.create(t)),e=e+"{"+goog.html.SafeStyle.unwrap(t).replace(/</g,"\\3C ")+"}",goog.html.SafeStyleSheet.createSafeStyleSheetSecurityPrivateDoNotAccessOrElse(e)},goog.html.SafeStyleSheet.hasBalancedBrackets_=function(e){for(var t={"(":")","[":"]"},o=[],r=0;r<e.length;r++){var s=e[r];if(t[s])o.push(t[s]);else if(goog.object.contains(t,s)&&o.pop()!=s)return !1}return 0==o.length},goog.html.SafeStyleSheet.concat=function(e){var t="",o=function(e){goog.isArray(e)?goog.array.forEach(e,o):t+=goog.html.SafeStyleSheet.unwrap(e);};return goog.array.forEach(arguments,o),goog.html.SafeStyleSheet.createSafeStyleSheetSecurityPrivateDoNotAccessOrElse(t)},goog.html.SafeStyleSheet.fromConstant=function(e){return 0===(e=goog.string.Const.unwrap(e)).length?goog.html.SafeStyleSheet.EMPTY:(goog.asserts.assert(!goog.string.internal.contains(e,"<"),"Forbidden '<' character in style sheet string: "+e),goog.html.SafeStyleSheet.createSafeStyleSheetSecurityPrivateDoNotAccessOrElse(e))},goog.html.SafeStyleSheet.prototype.getTypedStringValue=function(){return this.privateDoNotAccessOrElseSafeStyleSheetWrappedValue_},goog.DEBUG&&(goog.html.SafeStyleSheet.prototype.toString=function(){return "SafeStyleSheet{"+this.privateDoNotAccessOrElseSafeStyleSheetWrappedValue_+"}"}),goog.html.SafeStyleSheet.unwrap=function(e){return e instanceof goog.html.SafeStyleSheet&&e.constructor===goog.html.SafeStyleSheet&&e.SAFE_STYLE_SHEET_TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_===goog.html.SafeStyleSheet.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_?e.privateDoNotAccessOrElseSafeStyleSheetWrappedValue_:(goog.asserts.fail("expected object of type SafeStyleSheet, got '"+e+"' of type "+goog.typeOf(e)),"type_error:SafeStyleSheet")},goog.html.SafeStyleSheet.createSafeStyleSheetSecurityPrivateDoNotAccessOrElse=function(e){return (new goog.html.SafeStyleSheet).initSecurityPrivateDoNotAccessOrElse_(e)},goog.html.SafeStyleSheet.prototype.initSecurityPrivateDoNotAccessOrElse_=function(e){return this.privateDoNotAccessOrElseSafeStyleSheetWrappedValue_=e,this},goog.html.SafeStyleSheet.EMPTY=goog.html.SafeStyleSheet.createSafeStyleSheetSecurityPrivateDoNotAccessOrElse(""),goog.dom.tags={},goog.dom.tags.VOID_TAGS_={area:!0,base:!0,br:!0,col:!0,command:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0},goog.dom.tags.isVoidTag=function(e){return !0===goog.dom.tags.VOID_TAGS_[e]},goog.dom.HtmlElement=function(){},goog.dom.TagName=function(e){this.tagName_=e;},goog.dom.TagName.prototype.toString=function(){return this.tagName_},goog.dom.TagName.A=new goog.dom.TagName("A"),goog.dom.TagName.ABBR=new goog.dom.TagName("ABBR"),goog.dom.TagName.ACRONYM=new goog.dom.TagName("ACRONYM"),goog.dom.TagName.ADDRESS=new goog.dom.TagName("ADDRESS"),goog.dom.TagName.APPLET=new goog.dom.TagName("APPLET"),goog.dom.TagName.AREA=new goog.dom.TagName("AREA"),goog.dom.TagName.ARTICLE=new goog.dom.TagName("ARTICLE"),goog.dom.TagName.ASIDE=new goog.dom.TagName("ASIDE"),goog.dom.TagName.AUDIO=new goog.dom.TagName("AUDIO"),goog.dom.TagName.B=new goog.dom.TagName("B"),goog.dom.TagName.BASE=new goog.dom.TagName("BASE"),goog.dom.TagName.BASEFONT=new goog.dom.TagName("BASEFONT"),goog.dom.TagName.BDI=new goog.dom.TagName("BDI"),goog.dom.TagName.BDO=new goog.dom.TagName("BDO"),goog.dom.TagName.BIG=new goog.dom.TagName("BIG"),goog.dom.TagName.BLOCKQUOTE=new goog.dom.TagName("BLOCKQUOTE"),goog.dom.TagName.BODY=new goog.dom.TagName("BODY"),goog.dom.TagName.BR=new goog.dom.TagName("BR"),goog.dom.TagName.BUTTON=new goog.dom.TagName("BUTTON"),goog.dom.TagName.CANVAS=new goog.dom.TagName("CANVAS"),goog.dom.TagName.CAPTION=new goog.dom.TagName("CAPTION"),goog.dom.TagName.CENTER=new goog.dom.TagName("CENTER"),goog.dom.TagName.CITE=new goog.dom.TagName("CITE"),goog.dom.TagName.CODE=new goog.dom.TagName("CODE"),goog.dom.TagName.COL=new goog.dom.TagName("COL"),goog.dom.TagName.COLGROUP=new goog.dom.TagName("COLGROUP"),goog.dom.TagName.COMMAND=new goog.dom.TagName("COMMAND"),goog.dom.TagName.DATA=new goog.dom.TagName("DATA"),goog.dom.TagName.DATALIST=new goog.dom.TagName("DATALIST"),goog.dom.TagName.DD=new goog.dom.TagName("DD"),goog.dom.TagName.DEL=new goog.dom.TagName("DEL"),goog.dom.TagName.DETAILS=new goog.dom.TagName("DETAILS"),goog.dom.TagName.DFN=new goog.dom.TagName("DFN"),goog.dom.TagName.DIALOG=new goog.dom.TagName("DIALOG"),goog.dom.TagName.DIR=new goog.dom.TagName("DIR"),goog.dom.TagName.DIV=new goog.dom.TagName("DIV"),goog.dom.TagName.DL=new goog.dom.TagName("DL"),goog.dom.TagName.DT=new goog.dom.TagName("DT"),goog.dom.TagName.EM=new goog.dom.TagName("EM"),goog.dom.TagName.EMBED=new goog.dom.TagName("EMBED"),goog.dom.TagName.FIELDSET=new goog.dom.TagName("FIELDSET"),goog.dom.TagName.FIGCAPTION=new goog.dom.TagName("FIGCAPTION"),goog.dom.TagName.FIGURE=new goog.dom.TagName("FIGURE"),goog.dom.TagName.FONT=new goog.dom.TagName("FONT"),goog.dom.TagName.FOOTER=new goog.dom.TagName("FOOTER"),goog.dom.TagName.FORM=new goog.dom.TagName("FORM"),goog.dom.TagName.FRAME=new goog.dom.TagName("FRAME"),goog.dom.TagName.FRAMESET=new goog.dom.TagName("FRAMESET"),goog.dom.TagName.H1=new goog.dom.TagName("H1"),goog.dom.TagName.H2=new goog.dom.TagName("H2"),goog.dom.TagName.H3=new goog.dom.TagName("H3"),goog.dom.TagName.H4=new goog.dom.TagName("H4"),goog.dom.TagName.H5=new goog.dom.TagName("H5"),goog.dom.TagName.H6=new goog.dom.TagName("H6"),goog.dom.TagName.HEAD=new goog.dom.TagName("HEAD"),goog.dom.TagName.HEADER=new goog.dom.TagName("HEADER"),goog.dom.TagName.HGROUP=new goog.dom.TagName("HGROUP"),goog.dom.TagName.HR=new goog.dom.TagName("HR"),goog.dom.TagName.HTML=new goog.dom.TagName("HTML"),goog.dom.TagName.I=new goog.dom.TagName("I"),goog.dom.TagName.IFRAME=new goog.dom.TagName("IFRAME"),goog.dom.TagName.IMG=new goog.dom.TagName("IMG"),goog.dom.TagName.INPUT=new goog.dom.TagName("INPUT"),goog.dom.TagName.INS=new goog.dom.TagName("INS"),goog.dom.TagName.ISINDEX=new goog.dom.TagName("ISINDEX"),goog.dom.TagName.KBD=new goog.dom.TagName("KBD"),goog.dom.TagName.KEYGEN=new goog.dom.TagName("KEYGEN"),goog.dom.TagName.LABEL=new goog.dom.TagName("LABEL"),goog.dom.TagName.LEGEND=new goog.dom.TagName("LEGEND"),goog.dom.TagName.LI=new goog.dom.TagName("LI"),goog.dom.TagName.LINK=new goog.dom.TagName("LINK"),goog.dom.TagName.MAIN=new goog.dom.TagName("MAIN"),goog.dom.TagName.MAP=new goog.dom.TagName("MAP"),goog.dom.TagName.MARK=new goog.dom.TagName("MARK"),goog.dom.TagName.MATH=new goog.dom.TagName("MATH"),goog.dom.TagName.MENU=new goog.dom.TagName("MENU"),goog.dom.TagName.MENUITEM=new goog.dom.TagName("MENUITEM"),goog.dom.TagName.META=new goog.dom.TagName("META"),goog.dom.TagName.METER=new goog.dom.TagName("METER"),goog.dom.TagName.NAV=new goog.dom.TagName("NAV"),goog.dom.TagName.NOFRAMES=new goog.dom.TagName("NOFRAMES"),goog.dom.TagName.NOSCRIPT=new goog.dom.TagName("NOSCRIPT"),goog.dom.TagName.OBJECT=new goog.dom.TagName("OBJECT"),goog.dom.TagName.OL=new goog.dom.TagName("OL"),goog.dom.TagName.OPTGROUP=new goog.dom.TagName("OPTGROUP"),goog.dom.TagName.OPTION=new goog.dom.TagName("OPTION"),goog.dom.TagName.OUTPUT=new goog.dom.TagName("OUTPUT"),goog.dom.TagName.P=new goog.dom.TagName("P"),goog.dom.TagName.PARAM=new goog.dom.TagName("PARAM"),goog.dom.TagName.PICTURE=new goog.dom.TagName("PICTURE"),goog.dom.TagName.PRE=new goog.dom.TagName("PRE"),goog.dom.TagName.PROGRESS=new goog.dom.TagName("PROGRESS"),goog.dom.TagName.Q=new goog.dom.TagName("Q"),goog.dom.TagName.RP=new goog.dom.TagName("RP"),goog.dom.TagName.RT=new goog.dom.TagName("RT"),goog.dom.TagName.RTC=new goog.dom.TagName("RTC"),goog.dom.TagName.RUBY=new goog.dom.TagName("RUBY"),goog.dom.TagName.S=new goog.dom.TagName("S"),goog.dom.TagName.SAMP=new goog.dom.TagName("SAMP"),goog.dom.TagName.SCRIPT=new goog.dom.TagName("SCRIPT"),goog.dom.TagName.SECTION=new goog.dom.TagName("SECTION"),goog.dom.TagName.SELECT=new goog.dom.TagName("SELECT"),goog.dom.TagName.SMALL=new goog.dom.TagName("SMALL"),goog.dom.TagName.SOURCE=new goog.dom.TagName("SOURCE"),goog.dom.TagName.SPAN=new goog.dom.TagName("SPAN"),goog.dom.TagName.STRIKE=new goog.dom.TagName("STRIKE"),goog.dom.TagName.STRONG=new goog.dom.TagName("STRONG"),goog.dom.TagName.STYLE=new goog.dom.TagName("STYLE"),goog.dom.TagName.SUB=new goog.dom.TagName("SUB"),goog.dom.TagName.SUMMARY=new goog.dom.TagName("SUMMARY"),goog.dom.TagName.SUP=new goog.dom.TagName("SUP"),goog.dom.TagName.SVG=new goog.dom.TagName("SVG"),goog.dom.TagName.TABLE=new goog.dom.TagName("TABLE"),goog.dom.TagName.TBODY=new goog.dom.TagName("TBODY"),goog.dom.TagName.TD=new goog.dom.TagName("TD"),goog.dom.TagName.TEMPLATE=new goog.dom.TagName("TEMPLATE"),goog.dom.TagName.TEXTAREA=new goog.dom.TagName("TEXTAREA"),goog.dom.TagName.TFOOT=new goog.dom.TagName("TFOOT"),goog.dom.TagName.TH=new goog.dom.TagName("TH"),goog.dom.TagName.THEAD=new goog.dom.TagName("THEAD"),goog.dom.TagName.TIME=new goog.dom.TagName("TIME"),goog.dom.TagName.TITLE=new goog.dom.TagName("TITLE"),goog.dom.TagName.TR=new goog.dom.TagName("TR"),goog.dom.TagName.TRACK=new goog.dom.TagName("TRACK"),goog.dom.TagName.TT=new goog.dom.TagName("TT"),goog.dom.TagName.U=new goog.dom.TagName("U"),goog.dom.TagName.UL=new goog.dom.TagName("UL"),goog.dom.TagName.VAR=new goog.dom.TagName("VAR"),goog.dom.TagName.VIDEO=new goog.dom.TagName("VIDEO"),goog.dom.TagName.WBR=new goog.dom.TagName("WBR"),goog.labs={},goog.labs.userAgent={},goog.labs.userAgent.util={},goog.labs.userAgent.util.getNativeUserAgentString_=function(){var e=goog.labs.userAgent.util.getNavigator_();return e&&(e=e.userAgent)?e:""},goog.labs.userAgent.util.getNavigator_=function(){return goog.global.navigator},goog.labs.userAgent.util.userAgent_=goog.labs.userAgent.util.getNativeUserAgentString_(),goog.labs.userAgent.util.setUserAgent=function(e){goog.labs.userAgent.util.userAgent_=e||goog.labs.userAgent.util.getNativeUserAgentString_();},goog.labs.userAgent.util.getUserAgent=function(){return goog.labs.userAgent.util.userAgent_},goog.labs.userAgent.util.matchUserAgent=function(e){var t=goog.labs.userAgent.util.getUserAgent();return goog.string.internal.contains(t,e)},goog.labs.userAgent.util.matchUserAgentIgnoreCase=function(e){var t=goog.labs.userAgent.util.getUserAgent();return goog.string.internal.caseInsensitiveContains(t,e)},goog.labs.userAgent.util.extractVersionTuples=function(e){for(var t,o=/(\w[\w ]+)\/([^\s]+)\s*(?:\((.*?)\))?/g,r=[];t=o.exec(e);)r.push([t[1],t[2],t[3]||void 0]);return r},goog.labs.userAgent.browser={},goog.labs.userAgent.browser.matchOpera_=function(){return goog.labs.userAgent.util.matchUserAgent("Opera")},goog.labs.userAgent.browser.matchIE_=function(){return goog.labs.userAgent.util.matchUserAgent("Trident")||goog.labs.userAgent.util.matchUserAgent("MSIE")},goog.labs.userAgent.browser.matchEdgeHtml_=function(){return goog.labs.userAgent.util.matchUserAgent("Edge")},goog.labs.userAgent.browser.matchEdgeChromium_=function(){return goog.labs.userAgent.util.matchUserAgent("Edg/")},goog.labs.userAgent.browser.matchOperaChromium_=function(){return goog.labs.userAgent.util.matchUserAgent("OPR")},goog.labs.userAgent.browser.matchFirefox_=function(){return goog.labs.userAgent.util.matchUserAgent("Firefox")||goog.labs.userAgent.util.matchUserAgent("FxiOS")},goog.labs.userAgent.browser.matchSafari_=function(){return goog.labs.userAgent.util.matchUserAgent("Safari")&&!(goog.labs.userAgent.browser.matchChrome_()||goog.labs.userAgent.browser.matchCoast_()||goog.labs.userAgent.browser.matchOpera_()||goog.labs.userAgent.browser.matchEdgeHtml_()||goog.labs.userAgent.browser.matchEdgeChromium_()||goog.labs.userAgent.browser.matchOperaChromium_()||goog.labs.userAgent.browser.matchFirefox_()||goog.labs.userAgent.browser.isSilk()||goog.labs.userAgent.util.matchUserAgent("Android"))},goog.labs.userAgent.browser.matchCoast_=function(){return goog.labs.userAgent.util.matchUserAgent("Coast")},goog.labs.userAgent.browser.matchIosWebview_=function(){return (goog.labs.userAgent.util.matchUserAgent("iPad")||goog.labs.userAgent.util.matchUserAgent("iPhone"))&&!goog.labs.userAgent.browser.matchSafari_()&&!goog.labs.userAgent.browser.matchChrome_()&&!goog.labs.userAgent.browser.matchCoast_()&&!goog.labs.userAgent.browser.matchFirefox_()&&goog.labs.userAgent.util.matchUserAgent("AppleWebKit")},goog.labs.userAgent.browser.matchChrome_=function(){return (goog.labs.userAgent.util.matchUserAgent("Chrome")||goog.labs.userAgent.util.matchUserAgent("CriOS"))&&!goog.labs.userAgent.browser.matchEdgeHtml_()},goog.labs.userAgent.browser.matchAndroidBrowser_=function(){return goog.labs.userAgent.util.matchUserAgent("Android")&&!(goog.labs.userAgent.browser.isChrome()||goog.labs.userAgent.browser.isFirefox()||goog.labs.userAgent.browser.isOpera()||goog.labs.userAgent.browser.isSilk())},goog.labs.userAgent.browser.isOpera=goog.labs.userAgent.browser.matchOpera_,goog.labs.userAgent.browser.isIE=goog.labs.userAgent.browser.matchIE_,goog.labs.userAgent.browser.isEdge=goog.labs.userAgent.browser.matchEdgeHtml_,goog.labs.userAgent.browser.isEdgeChromium=goog.labs.userAgent.browser.matchEdgeChromium_,goog.labs.userAgent.browser.isOperaChromium=goog.labs.userAgent.browser.matchOperaChromium_,goog.labs.userAgent.browser.isFirefox=goog.labs.userAgent.browser.matchFirefox_,goog.labs.userAgent.browser.isSafari=goog.labs.userAgent.browser.matchSafari_,goog.labs.userAgent.browser.isCoast=goog.labs.userAgent.browser.matchCoast_,goog.labs.userAgent.browser.isIosWebview=goog.labs.userAgent.browser.matchIosWebview_,goog.labs.userAgent.browser.isChrome=goog.labs.userAgent.browser.matchChrome_,goog.labs.userAgent.browser.isAndroidBrowser=goog.labs.userAgent.browser.matchAndroidBrowser_,goog.labs.userAgent.browser.isSilk=function(){return goog.labs.userAgent.util.matchUserAgent("Silk")},goog.labs.userAgent.browser.getVersion=function(){function e(e){return e=goog.array.find(e,r),o[e]||""}var t=goog.labs.userAgent.util.getUserAgent();if(goog.labs.userAgent.browser.isIE())return goog.labs.userAgent.browser.getIEVersion_(t);t=goog.labs.userAgent.util.extractVersionTuples(t);var o={};goog.array.forEach(t,(function(e){o[e[0]]=e[1];}));var r=goog.partial(goog.object.containsKey,o);return goog.labs.userAgent.browser.isOpera()?e(["Version","Opera"]):goog.labs.userAgent.browser.isEdge()?e(["Edge"]):goog.labs.userAgent.browser.isEdgeChromium()?e(["Edg"]):goog.labs.userAgent.browser.isChrome()?e(["Chrome","CriOS"]):(t=t[2])&&t[1]||""},goog.labs.userAgent.browser.isVersionOrHigher=function(e){return 0<=goog.string.internal.compareVersions(goog.labs.userAgent.browser.getVersion(),e)},goog.labs.userAgent.browser.getIEVersion_=function(e){var t=/rv: *([\d\.]*)/.exec(e);if(t&&t[1])return t[1];t="";var o=/MSIE +([\d\.]+)/.exec(e);if(o&&o[1])if(e=/Trident\/(\d.\d)/.exec(e),"7.0"==o[1])if(e&&e[1])switch(e[1]){case"4.0":t="8.0";break;case"5.0":t="9.0";break;case"6.0":t="10.0";break;case"7.0":t="11.0";}else t="7.0";else t=o[1];return t},goog.html.SafeHtml=function(){this.privateDoNotAccessOrElseSafeHtmlWrappedValue_="",this.SAFE_HTML_TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_=goog.html.SafeHtml.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_,this.dir_=null;},goog.html.SafeHtml.prototype.implementsGoogI18nBidiDirectionalString=!0,goog.html.SafeHtml.prototype.getDirection=function(){return this.dir_},goog.html.SafeHtml.prototype.implementsGoogStringTypedString=!0,goog.html.SafeHtml.prototype.getTypedStringValue=function(){return this.privateDoNotAccessOrElseSafeHtmlWrappedValue_.toString()},goog.DEBUG&&(goog.html.SafeHtml.prototype.toString=function(){return "SafeHtml{"+this.privateDoNotAccessOrElseSafeHtmlWrappedValue_+"}"}),goog.html.SafeHtml.unwrap=function(e){return goog.html.SafeHtml.unwrapTrustedHTML(e).toString()},goog.html.SafeHtml.unwrapTrustedHTML=function(e){return e instanceof goog.html.SafeHtml&&e.constructor===goog.html.SafeHtml&&e.SAFE_HTML_TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_===goog.html.SafeHtml.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_?e.privateDoNotAccessOrElseSafeHtmlWrappedValue_:(goog.asserts.fail("expected object of type SafeHtml, got '"+e+"' of type "+goog.typeOf(e)),"type_error:SafeHtml")},goog.html.SafeHtml.htmlEscape=function(e){if(e instanceof goog.html.SafeHtml)return e;var t="object"==typeof e,o=null;return t&&e.implementsGoogI18nBidiDirectionalString&&(o=e.getDirection()),e=t&&e.implementsGoogStringTypedString?e.getTypedStringValue():String(e),goog.html.SafeHtml.createSafeHtmlSecurityPrivateDoNotAccessOrElse(goog.string.internal.htmlEscape(e),o)},goog.html.SafeHtml.htmlEscapePreservingNewlines=function(e){return e instanceof goog.html.SafeHtml?e:(e=goog.html.SafeHtml.htmlEscape(e),goog.html.SafeHtml.createSafeHtmlSecurityPrivateDoNotAccessOrElse(goog.string.internal.newLineToBr(goog.html.SafeHtml.unwrap(e)),e.getDirection()))},goog.html.SafeHtml.htmlEscapePreservingNewlinesAndSpaces=function(e){return e instanceof goog.html.SafeHtml?e:(e=goog.html.SafeHtml.htmlEscape(e),goog.html.SafeHtml.createSafeHtmlSecurityPrivateDoNotAccessOrElse(goog.string.internal.whitespaceEscape(goog.html.SafeHtml.unwrap(e)),e.getDirection()))},goog.html.SafeHtml.from=goog.html.SafeHtml.htmlEscape,goog.html.SafeHtml.VALID_NAMES_IN_TAG_=/^[a-zA-Z0-9-]+$/,goog.html.SafeHtml.URL_ATTRIBUTES_={action:!0,cite:!0,data:!0,formaction:!0,href:!0,manifest:!0,poster:!0,src:!0},goog.html.SafeHtml.NOT_ALLOWED_TAG_NAMES_={APPLET:!0,BASE:!0,EMBED:!0,IFRAME:!0,LINK:!0,MATH:!0,META:!0,OBJECT:!0,SCRIPT:!0,STYLE:!0,SVG:!0,TEMPLATE:!0},goog.html.SafeHtml.create=function(e,t,o){return goog.html.SafeHtml.verifyTagName(String(e)),goog.html.SafeHtml.createSafeHtmlTagSecurityPrivateDoNotAccessOrElse(String(e),t,o)},goog.html.SafeHtml.verifyTagName=function(e){if(!goog.html.SafeHtml.VALID_NAMES_IN_TAG_.test(e))throw Error("Invalid tag name <"+e+">.");if(e.toUpperCase()in goog.html.SafeHtml.NOT_ALLOWED_TAG_NAMES_)throw Error("Tag name <"+e+"> is not allowed for SafeHtml.")},goog.html.SafeHtml.createIframe=function(e,t,o,r){e&&goog.html.TrustedResourceUrl.unwrap(e);var s={};return s.src=e||null,s.srcdoc=t&&goog.html.SafeHtml.unwrap(t),e=goog.html.SafeHtml.combineAttributes(s,{sandbox:""},o),goog.html.SafeHtml.createSafeHtmlTagSecurityPrivateDoNotAccessOrElse("iframe",e,r)},goog.html.SafeHtml.createSandboxIframe=function(e,t,o,r){if(!goog.html.SafeHtml.canUseSandboxIframe())throw Error("The browser does not support sandboxed iframes.");var s={};return s.src=e?goog.html.SafeUrl.unwrap(goog.html.SafeUrl.sanitize(e)):null,s.srcdoc=t||null,s.sandbox="",e=goog.html.SafeHtml.combineAttributes(s,{},o),goog.html.SafeHtml.createSafeHtmlTagSecurityPrivateDoNotAccessOrElse("iframe",e,r)},goog.html.SafeHtml.canUseSandboxIframe=function(){return goog.global.HTMLIFrameElement&&"sandbox"in goog.global.HTMLIFrameElement.prototype},goog.html.SafeHtml.createScriptSrc=function(e,t){return goog.html.TrustedResourceUrl.unwrap(e),e=goog.html.SafeHtml.combineAttributes({src:e},{},t),goog.html.SafeHtml.createSafeHtmlTagSecurityPrivateDoNotAccessOrElse("script",e)},goog.html.SafeHtml.createScript=function(e,t){for(var o in t){var r=o.toLowerCase();if("language"==r||"src"==r||"text"==r||"type"==r)throw Error('Cannot set "'+r+'" attribute')}for(o="",e=goog.array.concat(e),r=0;r<e.length;r++)o+=goog.html.SafeScript.unwrap(e[r]);return e=goog.html.SafeHtml.createSafeHtmlSecurityPrivateDoNotAccessOrElse(o,goog.i18n.bidi.Dir.NEUTRAL),goog.html.SafeHtml.createSafeHtmlTagSecurityPrivateDoNotAccessOrElse("script",t,e)},goog.html.SafeHtml.createStyle=function(e,t){t=goog.html.SafeHtml.combineAttributes({type:"text/css"},{},t);var o="";e=goog.array.concat(e);for(var r=0;r<e.length;r++)o+=goog.html.SafeStyleSheet.unwrap(e[r]);return e=goog.html.SafeHtml.createSafeHtmlSecurityPrivateDoNotAccessOrElse(o,goog.i18n.bidi.Dir.NEUTRAL),goog.html.SafeHtml.createSafeHtmlTagSecurityPrivateDoNotAccessOrElse("style",t,e)},goog.html.SafeHtml.createMetaRefresh=function(e,t){return e=goog.html.SafeUrl.unwrap(goog.html.SafeUrl.sanitize(e)),(goog.labs.userAgent.browser.isIE()||goog.labs.userAgent.browser.isEdge())&&goog.string.internal.contains(e,";")&&(e="'"+e.replace(/'/g,"%27")+"'"),goog.html.SafeHtml.createSafeHtmlTagSecurityPrivateDoNotAccessOrElse("meta",{"http-equiv":"refresh",content:(t||0)+"; url="+e})},goog.html.SafeHtml.getAttrNameAndValue_=function(e,t,o){if(o instanceof goog.string.Const)o=goog.string.Const.unwrap(o);else if("style"==t.toLowerCase())o=goog.html.SafeHtml.getStyleValue_(o);else {if(/^on/i.test(t))throw Error('Attribute "'+t+'" requires goog.string.Const value, "'+o+'" given.');if(t.toLowerCase()in goog.html.SafeHtml.URL_ATTRIBUTES_)if(o instanceof goog.html.TrustedResourceUrl)o=goog.html.TrustedResourceUrl.unwrap(o);else if(o instanceof goog.html.SafeUrl)o=goog.html.SafeUrl.unwrap(o);else {if(!goog.isString(o))throw Error('Attribute "'+t+'" on tag "'+e+'" requires goog.html.SafeUrl, goog.string.Const, or string, value "'+o+'" given.');o=goog.html.SafeUrl.sanitize(o).getTypedStringValue();}}return o.implementsGoogStringTypedString&&(o=o.getTypedStringValue()),goog.asserts.assert(goog.isString(o)||goog.isNumber(o),"String or number value expected, got "+typeof o+" with value: "+o),t+'="'+goog.string.internal.htmlEscape(String(o))+'"'},goog.html.SafeHtml.getStyleValue_=function(e){if(!goog.isObject(e))throw Error('The "style" attribute requires goog.html.SafeStyle or map of style properties, '+typeof e+" given: "+e);return e instanceof goog.html.SafeStyle||(e=goog.html.SafeStyle.create(e)),goog.html.SafeStyle.unwrap(e)},goog.html.SafeHtml.createWithDir=function(e,t,o,r){return (t=goog.html.SafeHtml.create(t,o,r)).dir_=e,t},goog.html.SafeHtml.join=function(e,t){var o=(e=goog.html.SafeHtml.htmlEscape(e)).getDirection(),r=[],s=function(e){goog.isArray(e)?goog.array.forEach(e,s):(e=goog.html.SafeHtml.htmlEscape(e),r.push(goog.html.SafeHtml.unwrap(e)),e=e.getDirection(),o==goog.i18n.bidi.Dir.NEUTRAL?o=e:e!=goog.i18n.bidi.Dir.NEUTRAL&&o!=e&&(o=null));};return goog.array.forEach(t,s),goog.html.SafeHtml.createSafeHtmlSecurityPrivateDoNotAccessOrElse(r.join(goog.html.SafeHtml.unwrap(e)),o)},goog.html.SafeHtml.concat=function(e){return goog.html.SafeHtml.join(goog.html.SafeHtml.EMPTY,Array.prototype.slice.call(arguments))},goog.html.SafeHtml.concatWithDir=function(e,t){var o=goog.html.SafeHtml.concat(goog.array.slice(arguments,1));return o.dir_=e,o},goog.html.SafeHtml.TYPE_MARKER_GOOG_HTML_SECURITY_PRIVATE_={},goog.html.SafeHtml.createSafeHtmlSecurityPrivateDoNotAccessOrElse=function(e,t){return (new goog.html.SafeHtml).initSecurityPrivateDoNotAccessOrElse_(e,t)},goog.html.SafeHtml.prototype.initSecurityPrivateDoNotAccessOrElse_=function(e,t){return this.privateDoNotAccessOrElseSafeHtmlWrappedValue_=goog.html.trustedtypes.PRIVATE_DO_NOT_ACCESS_OR_ELSE_POLICY?goog.html.trustedtypes.PRIVATE_DO_NOT_ACCESS_OR_ELSE_POLICY.createHTML(e):e,this.dir_=t,this},goog.html.SafeHtml.createSafeHtmlTagSecurityPrivateDoNotAccessOrElse=function(e,t,o){var r=null,s="<"+e+goog.html.SafeHtml.stringifyAttributes(e,t);return goog.isDefAndNotNull(o)?goog.isArray(o)||(o=[o]):o=[],goog.dom.tags.isVoidTag(e.toLowerCase())?(goog.asserts.assert(!o.length,"Void tag <"+e+"> does not allow content."),s+=">"):(r=goog.html.SafeHtml.concat(o),s+=">"+goog.html.SafeHtml.unwrap(r)+"</"+e+">",r=r.getDirection()),(e=t&&t.dir)&&(r=/^(ltr|rtl|auto)$/i.test(e)?goog.i18n.bidi.Dir.NEUTRAL:null),goog.html.SafeHtml.createSafeHtmlSecurityPrivateDoNotAccessOrElse(s,r)},goog.html.SafeHtml.stringifyAttributes=function(e,t){var o="";if(t)for(var r in t){if(!goog.html.SafeHtml.VALID_NAMES_IN_TAG_.test(r))throw Error('Invalid attribute name "'+r+'".');var s=t[r];goog.isDefAndNotNull(s)&&(o+=" "+goog.html.SafeHtml.getAttrNameAndValue_(e,r,s));}return o},goog.html.SafeHtml.combineAttributes=function(e,t,o){var r,s={};for(r in e)goog.asserts.assert(r.toLowerCase()==r,"Must be lower case"),s[r]=e[r];for(r in t)goog.asserts.assert(r.toLowerCase()==r,"Must be lower case"),s[r]=t[r];for(r in o){var n=r.toLowerCase();if(n in e)throw Error('Cannot override "'+n+'" attribute, got "'+r+'" with value "'+o[r]+'"');n in t&&delete s[n],s[r]=o[r];}return s},goog.html.SafeHtml.DOCTYPE_HTML=goog.html.SafeHtml.createSafeHtmlSecurityPrivateDoNotAccessOrElse("<!DOCTYPE html>",goog.i18n.bidi.Dir.NEUTRAL),goog.html.SafeHtml.EMPTY=goog.html.SafeHtml.createSafeHtmlSecurityPrivateDoNotAccessOrElse("",goog.i18n.bidi.Dir.NEUTRAL),goog.html.SafeHtml.BR=goog.html.SafeHtml.createSafeHtmlSecurityPrivateDoNotAccessOrElse("<br>",goog.i18n.bidi.Dir.NEUTRAL),goog.html.uncheckedconversions={},goog.html.uncheckedconversions.safeHtmlFromStringKnownToSatisfyTypeContract=function(e,t,o){return goog.asserts.assertString(goog.string.Const.unwrap(e),"must provide justification"),goog.asserts.assert(!goog.string.internal.isEmptyOrWhitespace(goog.string.Const.unwrap(e)),"must provide non-empty justification"),goog.html.SafeHtml.createSafeHtmlSecurityPrivateDoNotAccessOrElse(t,o||null)},goog.html.uncheckedconversions.safeScriptFromStringKnownToSatisfyTypeContract=function(e,t){return goog.asserts.assertString(goog.string.Const.unwrap(e),"must provide justification"),goog.asserts.assert(!goog.string.internal.isEmptyOrWhitespace(goog.string.Const.unwrap(e)),"must provide non-empty justification"),goog.html.SafeScript.createSafeScriptSecurityPrivateDoNotAccessOrElse(t)},goog.html.uncheckedconversions.safeStyleFromStringKnownToSatisfyTypeContract=function(e,t){return goog.asserts.assertString(goog.string.Const.unwrap(e),"must provide justification"),goog.asserts.assert(!goog.string.internal.isEmptyOrWhitespace(goog.string.Const.unwrap(e)),"must provide non-empty justification"),goog.html.SafeStyle.createSafeStyleSecurityPrivateDoNotAccessOrElse(t)},goog.html.uncheckedconversions.safeStyleSheetFromStringKnownToSatisfyTypeContract=function(e,t){return goog.asserts.assertString(goog.string.Const.unwrap(e),"must provide justification"),goog.asserts.assert(!goog.string.internal.isEmptyOrWhitespace(goog.string.Const.unwrap(e)),"must provide non-empty justification"),goog.html.SafeStyleSheet.createSafeStyleSheetSecurityPrivateDoNotAccessOrElse(t)},goog.html.uncheckedconversions.safeUrlFromStringKnownToSatisfyTypeContract=function(e,t){return goog.asserts.assertString(goog.string.Const.unwrap(e),"must provide justification"),goog.asserts.assert(!goog.string.internal.isEmptyOrWhitespace(goog.string.Const.unwrap(e)),"must provide non-empty justification"),goog.html.SafeUrl.createSafeUrlSecurityPrivateDoNotAccessOrElse(t)},goog.html.uncheckedconversions.trustedResourceUrlFromStringKnownToSatisfyTypeContract=function(e,t){return goog.asserts.assertString(goog.string.Const.unwrap(e),"must provide justification"),goog.asserts.assert(!goog.string.internal.isEmptyOrWhitespace(goog.string.Const.unwrap(e)),"must provide non-empty justification"),goog.html.TrustedResourceUrl.createTrustedResourceUrlSecurityPrivateDoNotAccessOrElse(t)},goog.dom.asserts={},goog.dom.asserts.assertIsLocation=function(e){if(goog.asserts.ENABLE_ASSERTS){var t=goog.dom.asserts.getWindow_(e);t&&(!e||!(e instanceof t.Location)&&e instanceof t.Element)&&goog.asserts.fail("Argument is not a Location (or a non-Element mock); got: %s",goog.dom.asserts.debugStringForType_(e));}return e},goog.dom.asserts.assertIsElementType_=function(e,t){if(goog.asserts.ENABLE_ASSERTS){var o=goog.dom.asserts.getWindow_(e);o&&void 0!==o[t]&&(e&&(e instanceof o[t]||!(e instanceof o.Location||e instanceof o.Element))||goog.asserts.fail("Argument is not a %s (or a non-Element, non-Location mock); got: %s",t,goog.dom.asserts.debugStringForType_(e)));}return e},goog.dom.asserts.assertIsHTMLAnchorElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLAnchorElement")},goog.dom.asserts.assertIsHTMLButtonElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLButtonElement")},goog.dom.asserts.assertIsHTMLLinkElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLLinkElement")},goog.dom.asserts.assertIsHTMLImageElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLImageElement")},goog.dom.asserts.assertIsHTMLAudioElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLAudioElement")},goog.dom.asserts.assertIsHTMLVideoElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLVideoElement")},goog.dom.asserts.assertIsHTMLInputElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLInputElement")},goog.dom.asserts.assertIsHTMLTextAreaElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLTextAreaElement")},goog.dom.asserts.assertIsHTMLCanvasElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLCanvasElement")},goog.dom.asserts.assertIsHTMLEmbedElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLEmbedElement")},goog.dom.asserts.assertIsHTMLFormElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLFormElement")},goog.dom.asserts.assertIsHTMLFrameElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLFrameElement")},goog.dom.asserts.assertIsHTMLIFrameElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLIFrameElement")},goog.dom.asserts.assertIsHTMLObjectElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLObjectElement")},goog.dom.asserts.assertIsHTMLScriptElement=function(e){return goog.dom.asserts.assertIsElementType_(e,"HTMLScriptElement")},goog.dom.asserts.debugStringForType_=function(e){if(!goog.isObject(e))return void 0===e?"undefined":null===e?"null":typeof e;try{return e.constructor.displayName||e.constructor.name||Object.prototype.toString.call(e)}catch(e){return "<object could not be stringified>"}},goog.dom.asserts.getWindow_=function(e){try{var t=e&&e.ownerDocument,o=t&&(t.defaultView||t.parentWindow);if((o=o||goog.global).Element&&o.Location)return o}catch(e){}return null},goog.functions={},goog.functions.constant=function(e){return function(){return e}},goog.functions.FALSE=function(){return !1},goog.functions.TRUE=function(){return !0},goog.functions.NULL=function(){return null},goog.functions.identity=function(e,t){return e},goog.functions.error=function(e){return function(){throw Error(e)}},goog.functions.fail=function(e){return function(){throw e}},goog.functions.lock=function(e,t){return t=t||0,function(){return e.apply(this,Array.prototype.slice.call(arguments,0,t))}},goog.functions.nth=function(e){return function(){return arguments[e]}},goog.functions.partialRight=function(e,t){var o=Array.prototype.slice.call(arguments,1);return function(){var t=Array.prototype.slice.call(arguments);return t.push.apply(t,o),e.apply(this,t)}},goog.functions.withReturnValue=function(e,t){return goog.functions.sequence(e,goog.functions.constant(t))},goog.functions.equalTo=function(e,t){return function(o){return t?e==o:e===o}},goog.functions.compose=function(e,t){var o=arguments,r=o.length;return function(){var e;r&&(e=o[r-1].apply(this,arguments));for(var t=r-2;0<=t;t--)e=o[t].call(this,e);return e}},goog.functions.sequence=function(e){var t=arguments,o=t.length;return function(){for(var e,r=0;r<o;r++)e=t[r].apply(this,arguments);return e}},goog.functions.and=function(e){var t=arguments,o=t.length;return function(){for(var e=0;e<o;e++)if(!t[e].apply(this,arguments))return !1;return !0}},goog.functions.or=function(e){var t=arguments,o=t.length;return function(){for(var e=0;e<o;e++)if(t[e].apply(this,arguments))return !0;return !1}},goog.functions.not=function(e){return function(){return !e.apply(this,arguments)}},goog.functions.create=function(e,t){var o=function(){};return o.prototype=e.prototype,o=new o,e.apply(o,Array.prototype.slice.call(arguments,1)),o},goog.functions.CACHE_RETURN_VALUE=!0,goog.functions.cacheReturnValue=function(e){var t,o=!1;return function(){return goog.functions.CACHE_RETURN_VALUE?(o||(t=e(),o=!0),t):e()}},goog.functions.once=function(e){var t=e;return function(){if(t){var e=t;t=null,e();}}},goog.functions.debounce=function(e,t,o){var r=0;return function(s){goog.global.clearTimeout(r);var n=arguments;r=goog.global.setTimeout((function(){e.apply(o,n);}),t);}},goog.functions.throttle=function(e,t,o){var r=0,s=!1,n=[],i=function(){r=0,s&&(s=!1,a());},a=function(){r=goog.global.setTimeout(i,t),e.apply(o,n);};return function(e){n=arguments,r?s=!0:a();}},goog.functions.rateLimit=function(e,t,o){var r=0,s=function(){r=0;};return function(n){r||(r=goog.global.setTimeout(s,t),e.apply(o,arguments));}},goog.dom.safe={},goog.dom.safe.InsertAdjacentHtmlPosition={AFTERBEGIN:"afterbegin",AFTEREND:"afterend",BEFOREBEGIN:"beforebegin",BEFOREEND:"beforeend"},goog.dom.safe.insertAdjacentHtml=function(e,t,o){e.insertAdjacentHTML(t,goog.html.SafeHtml.unwrapTrustedHTML(o));},goog.dom.safe.SET_INNER_HTML_DISALLOWED_TAGS_={MATH:!0,SCRIPT:!0,STYLE:!0,SVG:!0,TEMPLATE:!0},goog.dom.safe.isInnerHtmlCleanupRecursive_=goog.functions.cacheReturnValue((function(){if(goog.DEBUG&&"undefined"==typeof document)return !1;var e=document.createElement("div"),t=document.createElement("div");return t.appendChild(document.createElement("div")),e.appendChild(t),!(goog.DEBUG&&!e.firstChild)&&(t=e.firstChild.firstChild,e.innerHTML=goog.html.SafeHtml.unwrapTrustedHTML(goog.html.SafeHtml.EMPTY),!t.parentElement)})),goog.dom.safe.unsafeSetInnerHtmlDoNotUseOrElse=function(e,t){if(goog.dom.safe.isInnerHtmlCleanupRecursive_())for(;e.lastChild;)e.removeChild(e.lastChild);e.innerHTML=goog.html.SafeHtml.unwrapTrustedHTML(t);},goog.dom.safe.setInnerHtml=function(e,t){if(goog.asserts.ENABLE_ASSERTS){var o=e.tagName.toUpperCase();if(goog.dom.safe.SET_INNER_HTML_DISALLOWED_TAGS_[o])throw Error("goog.dom.safe.setInnerHtml cannot be used to set content of "+e.tagName+".")}goog.dom.safe.unsafeSetInnerHtmlDoNotUseOrElse(e,t);},goog.dom.safe.setOuterHtml=function(e,t){e.outerHTML=goog.html.SafeHtml.unwrapTrustedHTML(t);},goog.dom.safe.setFormElementAction=function(e,t){t=t instanceof goog.html.SafeUrl?t:goog.html.SafeUrl.sanitizeAssertUnchanged(t),goog.dom.asserts.assertIsHTMLFormElement(e).action=goog.html.SafeUrl.unwrapTrustedURL(t);},goog.dom.safe.setButtonFormAction=function(e,t){t=t instanceof goog.html.SafeUrl?t:goog.html.SafeUrl.sanitizeAssertUnchanged(t),goog.dom.asserts.assertIsHTMLButtonElement(e).formAction=goog.html.SafeUrl.unwrapTrustedURL(t);},goog.dom.safe.setInputFormAction=function(e,t){t=t instanceof goog.html.SafeUrl?t:goog.html.SafeUrl.sanitizeAssertUnchanged(t),goog.dom.asserts.assertIsHTMLInputElement(e).formAction=goog.html.SafeUrl.unwrapTrustedURL(t);},goog.dom.safe.setStyle=function(e,t){e.style.cssText=goog.html.SafeStyle.unwrap(t);},goog.dom.safe.documentWrite=function(e,t){e.write(goog.html.SafeHtml.unwrapTrustedHTML(t));},goog.dom.safe.setAnchorHref=function(e,t){goog.dom.asserts.assertIsHTMLAnchorElement(e),t=t instanceof goog.html.SafeUrl?t:goog.html.SafeUrl.sanitizeAssertUnchanged(t),e.href=goog.html.SafeUrl.unwrapTrustedURL(t);},goog.dom.safe.setImageSrc=function(e,t){if(goog.dom.asserts.assertIsHTMLImageElement(e),!(t instanceof goog.html.SafeUrl)){var o=/^data:image\//i.test(t);t=goog.html.SafeUrl.sanitizeAssertUnchanged(t,o);}e.src=goog.html.SafeUrl.unwrapTrustedURL(t);},goog.dom.safe.setAudioSrc=function(e,t){if(goog.dom.asserts.assertIsHTMLAudioElement(e),!(t instanceof goog.html.SafeUrl)){var o=/^data:audio\//i.test(t);t=goog.html.SafeUrl.sanitizeAssertUnchanged(t,o);}e.src=goog.html.SafeUrl.unwrapTrustedURL(t);},goog.dom.safe.setVideoSrc=function(e,t){if(goog.dom.asserts.assertIsHTMLVideoElement(e),!(t instanceof goog.html.SafeUrl)){var o=/^data:video\//i.test(t);t=goog.html.SafeUrl.sanitizeAssertUnchanged(t,o);}e.src=goog.html.SafeUrl.unwrapTrustedURL(t);},goog.dom.safe.setEmbedSrc=function(e,t){goog.dom.asserts.assertIsHTMLEmbedElement(e),e.src=goog.html.TrustedResourceUrl.unwrapTrustedScriptURL(t);},goog.dom.safe.setFrameSrc=function(e,t){goog.dom.asserts.assertIsHTMLFrameElement(e),e.src=goog.html.TrustedResourceUrl.unwrapTrustedURL(t);},goog.dom.safe.setIframeSrc=function(e,t){goog.dom.asserts.assertIsHTMLIFrameElement(e),e.src=goog.html.TrustedResourceUrl.unwrapTrustedURL(t);},goog.dom.safe.setIframeSrcdoc=function(e,t){goog.dom.asserts.assertIsHTMLIFrameElement(e),e.srcdoc=goog.html.SafeHtml.unwrapTrustedHTML(t);},goog.dom.safe.setLinkHrefAndRel=function(e,t,o){goog.dom.asserts.assertIsHTMLLinkElement(e),e.rel=o,goog.string.internal.caseInsensitiveContains(o,"stylesheet")?(goog.asserts.assert(t instanceof goog.html.TrustedResourceUrl,'URL must be TrustedResourceUrl because "rel" contains "stylesheet"'),e.href=goog.html.TrustedResourceUrl.unwrapTrustedURL(t)):e.href=t instanceof goog.html.TrustedResourceUrl?goog.html.TrustedResourceUrl.unwrapTrustedURL(t):t instanceof goog.html.SafeUrl?goog.html.SafeUrl.unwrapTrustedURL(t):goog.html.SafeUrl.unwrapTrustedURL(goog.html.SafeUrl.sanitizeAssertUnchanged(t));},goog.dom.safe.setObjectData=function(e,t){goog.dom.asserts.assertIsHTMLObjectElement(e),e.data=goog.html.TrustedResourceUrl.unwrapTrustedScriptURL(t);},goog.dom.safe.setScriptSrc=function(e,t){goog.dom.asserts.assertIsHTMLScriptElement(e),e.src=goog.html.TrustedResourceUrl.unwrapTrustedScriptURL(t),(t=goog.getScriptNonce())&&e.setAttribute("nonce",t);},goog.dom.safe.setScriptContent=function(e,t){goog.dom.asserts.assertIsHTMLScriptElement(e),e.text=goog.html.SafeScript.unwrapTrustedScript(t),(t=goog.getScriptNonce())&&e.setAttribute("nonce",t);},goog.dom.safe.setLocationHref=function(e,t){goog.dom.asserts.assertIsLocation(e),t=t instanceof goog.html.SafeUrl?t:goog.html.SafeUrl.sanitizeAssertUnchanged(t),e.href=goog.html.SafeUrl.unwrapTrustedURL(t);},goog.dom.safe.assignLocation=function(e,t){goog.dom.asserts.assertIsLocation(e),t=t instanceof goog.html.SafeUrl?t:goog.html.SafeUrl.sanitizeAssertUnchanged(t),e.assign(goog.html.SafeUrl.unwrapTrustedURL(t));},goog.dom.safe.replaceLocation=function(e,t){goog.dom.asserts.assertIsLocation(e),t=t instanceof goog.html.SafeUrl?t:goog.html.SafeUrl.sanitizeAssertUnchanged(t),e.replace(goog.html.SafeUrl.unwrapTrustedURL(t));},goog.dom.safe.openInWindow=function(e,t,o,r,s){return e=e instanceof goog.html.SafeUrl?e:goog.html.SafeUrl.sanitizeAssertUnchanged(e),(t||goog.global).open(goog.html.SafeUrl.unwrapTrustedURL(e),o?goog.string.Const.unwrap(o):"",r,s)},goog.dom.safe.parseFromStringHtml=function(e,t){return goog.dom.safe.parseFromString(e,t,"text/html")},goog.dom.safe.parseFromString=function(e,t,o){return e.parseFromString(goog.html.SafeHtml.unwrapTrustedHTML(t),o)},goog.dom.safe.createImageFromBlob=function(e){if(!/^image\/.*/g.test(e.type))throw Error("goog.dom.safe.createImageFromBlob only accepts MIME type image/.*.");var t=goog.global.URL.createObjectURL(e);return (e=new goog.global.Image).onload=function(){goog.global.URL.revokeObjectURL(t);},goog.dom.safe.setImageSrc(e,goog.html.uncheckedconversions.safeUrlFromStringKnownToSatisfyTypeContract(goog.string.Const.from("Image blob URL."),t)),e},goog.string.DETECT_DOUBLE_ESCAPING=!1,goog.string.FORCE_NON_DOM_HTML_UNESCAPING=!1,goog.string.Unicode={NBSP:" "},goog.string.startsWith=goog.string.internal.startsWith,goog.string.endsWith=goog.string.internal.endsWith,goog.string.caseInsensitiveStartsWith=goog.string.internal.caseInsensitiveStartsWith,goog.string.caseInsensitiveEndsWith=goog.string.internal.caseInsensitiveEndsWith,goog.string.caseInsensitiveEquals=goog.string.internal.caseInsensitiveEquals,goog.string.subs=function(e,t){for(var o=e.split("%s"),r="",s=Array.prototype.slice.call(arguments,1);s.length&&1<o.length;)r+=o.shift()+s.shift();return r+o.join("%s")},goog.string.collapseWhitespace=function(e){return e.replace(/[\s\xa0]+/g," ").replace(/^\s+|\s+$/g,"")},goog.string.isEmptyOrWhitespace=goog.string.internal.isEmptyOrWhitespace,goog.string.isEmptyString=function(e){return 0==e.length},goog.string.isEmpty=goog.string.isEmptyOrWhitespace,goog.string.isEmptyOrWhitespaceSafe=function(e){return goog.string.isEmptyOrWhitespace(goog.string.makeSafe(e))},goog.string.isEmptySafe=goog.string.isEmptyOrWhitespaceSafe,goog.string.isBreakingWhitespace=function(e){return !/[^\t\n\r ]/.test(e)},goog.string.isAlpha=function(e){return !/[^a-zA-Z]/.test(e)},goog.string.isNumeric=function(e){return !/[^0-9]/.test(e)},goog.string.isAlphaNumeric=function(e){return !/[^a-zA-Z0-9]/.test(e)},goog.string.isSpace=function(e){return " "==e},goog.string.isUnicodeChar=function(e){return 1==e.length&&" "<=e&&"~">=e||""<=e&&"�">=e},goog.string.stripNewlines=function(e){return e.replace(/(\r\n|\r|\n)+/g," ")},goog.string.canonicalizeNewlines=function(e){return e.replace(/(\r\n|\r|\n)/g,"\n")},goog.string.normalizeWhitespace=function(e){return e.replace(/\xa0|\s/g," ")},goog.string.normalizeSpaces=function(e){return e.replace(/\xa0|[ \t]+/g," ")},goog.string.collapseBreakingSpaces=function(e){return e.replace(/[\t\r\n ]+/g," ").replace(/^[\t\r\n ]+|[\t\r\n ]+$/g,"")},goog.string.trim=goog.string.internal.trim,goog.string.trimLeft=function(e){return e.replace(/^[\s\xa0]+/,"")},goog.string.trimRight=function(e){return e.replace(/[\s\xa0]+$/,"")},goog.string.caseInsensitiveCompare=goog.string.internal.caseInsensitiveCompare,goog.string.numberAwareCompare_=function(e,t,o){if(e==t)return 0;if(!e)return -1;if(!t)return 1;for(var r=e.toLowerCase().match(o),s=t.toLowerCase().match(o),n=Math.min(r.length,s.length),i=0;i<n;i++){o=r[i];var a=s[i];if(o!=a)return e=parseInt(o,10),!isNaN(e)&&(t=parseInt(a,10),!isNaN(t)&&e-t)?e-t:o<a?-1:1}return r.length!=s.length?r.length-s.length:e<t?-1:1},goog.string.intAwareCompare=function(e,t){return goog.string.numberAwareCompare_(e,t,/\d+|\D+/g)},goog.string.floatAwareCompare=function(e,t){return goog.string.numberAwareCompare_(e,t,/\d+|\.\d+|\D+/g)},goog.string.numerateCompare=goog.string.floatAwareCompare,goog.string.urlEncode=function(e){return encodeURIComponent(String(e))},goog.string.urlDecode=function(e){return decodeURIComponent(e.replace(/\+/g," "))},goog.string.newLineToBr=goog.string.internal.newLineToBr,goog.string.htmlEscape=function(e,t){return e=goog.string.internal.htmlEscape(e,t),goog.string.DETECT_DOUBLE_ESCAPING&&(e=e.replace(goog.string.E_RE_,"&#101;")),e},goog.string.E_RE_=/e/g,goog.string.unescapeEntities=function(e){return goog.string.contains(e,"&")?!goog.string.FORCE_NON_DOM_HTML_UNESCAPING&&"document"in goog.global?goog.string.unescapeEntitiesUsingDom_(e):goog.string.unescapePureXmlEntities_(e):e},goog.string.unescapeEntitiesWithDocument=function(e,t){return goog.string.contains(e,"&")?goog.string.unescapeEntitiesUsingDom_(e,t):e},goog.string.unescapeEntitiesUsingDom_=function(e,t){var o={"&amp;":"&","&lt;":"<","&gt;":">","&quot;":'"'},r=t?t.createElement("div"):goog.global.document.createElement("div");return e.replace(goog.string.HTML_ENTITY_PATTERN_,(function(e,t){var s=o[e];return s||("#"==t.charAt(0)&&(t=Number("0"+t.substr(1)),isNaN(t)||(s=String.fromCharCode(t))),s||(goog.dom.safe.setInnerHtml(r,goog.html.uncheckedconversions.safeHtmlFromStringKnownToSatisfyTypeContract(goog.string.Const.from("Single HTML entity."),e+" ")),s=r.firstChild.nodeValue.slice(0,-1)),o[e]=s)}))},goog.string.unescapePureXmlEntities_=function(e){return e.replace(/&([^;]+);/g,(function(e,t){switch(t){case"amp":return "&";case"lt":return "<";case"gt":return ">";case"quot":return '"';default:return "#"!=t.charAt(0)||(t=Number("0"+t.substr(1)),isNaN(t))?e:String.fromCharCode(t)}}))},goog.string.HTML_ENTITY_PATTERN_=/&([^;\s<&]+);?/g,goog.string.whitespaceEscape=function(e,t){return goog.string.newLineToBr(e.replace(/  /g," &#160;"),t)},goog.string.preserveSpaces=function(e){return e.replace(/(^|[\n ]) /g,"$1"+goog.string.Unicode.NBSP)},goog.string.stripQuotes=function(e,t){for(var o=t.length,r=0;r<o;r++){var s=1==o?t:t.charAt(r);if(e.charAt(0)==s&&e.charAt(e.length-1)==s)return e.substring(1,e.length-1)}return e},goog.string.truncate=function(e,t,o){return o&&(e=goog.string.unescapeEntities(e)),e.length>t&&(e=e.substring(0,t-3)+"..."),o&&(e=goog.string.htmlEscape(e)),e},goog.string.truncateMiddle=function(e,t,o,r){if(o&&(e=goog.string.unescapeEntities(e)),r&&e.length>t){r>t&&(r=t);var s=e.length-r;e=e.substring(0,t-r)+"..."+e.substring(s);}else e.length>t&&(r=Math.floor(t/2),s=e.length-r,e=e.substring(0,r+t%2)+"..."+e.substring(s));return o&&(e=goog.string.htmlEscape(e)),e},goog.string.specialEscapeChars_={"\0":"\\0","\b":"\\b","\f":"\\f","\n":"\\n","\r":"\\r","\t":"\\t","\v":"\\x0B",'"':'\\"',"\\":"\\\\","<":"\\u003C"},goog.string.jsEscapeCache_={"'":"\\'"},goog.string.quote=function(e){e=String(e);for(var t=['"'],o=0;o<e.length;o++){var r=e.charAt(o),s=r.charCodeAt(0);t[o+1]=goog.string.specialEscapeChars_[r]||(31<s&&127>s?r:goog.string.escapeChar(r));}return t.push('"'),t.join("")},goog.string.escapeString=function(e){for(var t=[],o=0;o<e.length;o++)t[o]=goog.string.escapeChar(e.charAt(o));return t.join("")},goog.string.escapeChar=function(e){if(e in goog.string.jsEscapeCache_)return goog.string.jsEscapeCache_[e];if(e in goog.string.specialEscapeChars_)return goog.string.jsEscapeCache_[e]=goog.string.specialEscapeChars_[e];var t=e.charCodeAt(0);if(31<t&&127>t)var o=e;else 256>t?(o="\\x",(16>t||256<t)&&(o+="0")):(o="\\u",4096>t&&(o+="0")),o+=t.toString(16).toUpperCase();return goog.string.jsEscapeCache_[e]=o},goog.string.contains=goog.string.internal.contains,goog.string.caseInsensitiveContains=goog.string.internal.caseInsensitiveContains,goog.string.countOf=function(e,t){return e&&t?e.split(t).length-1:0},goog.string.removeAt=function(e,t,o){var r=e;return 0<=t&&t<e.length&&0<o&&(r=e.substr(0,t)+e.substr(t+o,e.length-t-o)),r},goog.string.remove=function(e,t){return e.replace(t,"")},goog.string.removeAll=function(e,t){return t=new RegExp(goog.string.regExpEscape(t),"g"),e.replace(t,"")},goog.string.replaceAll=function(e,t,o){return t=new RegExp(goog.string.regExpEscape(t),"g"),e.replace(t,o.replace(/\$/g,"$$$$"))},goog.string.regExpEscape=function(e){return String(e).replace(/([-()\[\]{}+?*.$\^|,:#<!\\])/g,"\\$1").replace(/\x08/g,"\\x08")},goog.string.repeat=String.prototype.repeat?function(e,t){return e.repeat(t)}:function(e,t){return Array(t+1).join(e)},goog.string.padNumber=function(e,t,o){return -1==(o=(e=goog.isDef(o)?e.toFixed(o):String(e)).indexOf("."))&&(o=e.length),goog.string.repeat("0",Math.max(0,t-o))+e},goog.string.makeSafe=function(e){return null==e?"":String(e)},goog.string.buildString=function(e){return Array.prototype.join.call(arguments,"")},goog.string.getRandomString=function(){return Math.floor(2147483648*Math.random()).toString(36)+Math.abs(Math.floor(2147483648*Math.random())^goog.now()).toString(36)},goog.string.compareVersions=goog.string.internal.compareVersions,goog.string.hashCode=function(e){for(var t=0,o=0;o<e.length;++o)t=31*t+e.charCodeAt(o)>>>0;return t},goog.string.uniqueStringCounter_=2147483648*Math.random()|0,goog.string.createUniqueString=function(){return "goog_"+goog.string.uniqueStringCounter_++},goog.string.toNumber=function(e){var t=Number(e);return 0==t&&goog.string.isEmptyOrWhitespace(e)?NaN:t},goog.string.isLowerCamelCase=function(e){return /^[a-z]+([A-Z][a-z]*)*$/.test(e)},goog.string.isUpperCamelCase=function(e){return /^([A-Z][a-z]*)+$/.test(e)},goog.string.toCamelCase=function(e){return String(e).replace(/\-([a-z])/g,(function(e,t){return t.toUpperCase()}))},goog.string.toSelectorCase=function(e){return String(e).replace(/([A-Z])/g,"-$1").toLowerCase()},goog.string.toTitleCase=function(e,t){return t=goog.isString(t)?goog.string.regExpEscape(t):"\\s",e.replace(new RegExp("(^"+(t?"|["+t+"]+":"")+")([a-z])","g"),(function(e,t,o){return t+o.toUpperCase()}))},goog.string.capitalize=function(e){return String(e.charAt(0)).toUpperCase()+String(e.substr(1)).toLowerCase()},goog.string.parseInt=function(e){return isFinite(e)&&(e=String(e)),goog.isString(e)?/^\s*-?0x/i.test(e)?parseInt(e,16):parseInt(e,10):NaN},goog.string.splitLimit=function(e,t,o){e=e.split(t);for(var r=[];0<o&&e.length;)r.push(e.shift()),o--;return e.length&&r.push(e.join(t)),r},goog.string.lastComponent=function(e,t){if(!t)return e;"string"==typeof t&&(t=[t]);for(var o=-1,r=0;r<t.length;r++)if(""!=t[r]){var s=e.lastIndexOf(t[r]);s>o&&(o=s);}return -1==o?e:e.slice(o+1)},goog.string.editDistance=function(e,t){var o=[],r=[];if(e==t)return 0;if(!e.length||!t.length)return Math.max(e.length,t.length);for(var s=0;s<t.length+1;s++)o[s]=s;for(s=0;s<e.length;s++){r[0]=s+1;for(var n=0;n<t.length;n++)r[n+1]=Math.min(r[n]+1,o[n+1]+1,o[n]+Number(e[s]!=t[n]));for(n=0;n<o.length;n++)o[n]=r[n];}return r[t.length]},goog.labs.userAgent.platform={},goog.labs.userAgent.platform.isAndroid=function(){return goog.labs.userAgent.util.matchUserAgent("Android")},goog.labs.userAgent.platform.isIpod=function(){return goog.labs.userAgent.util.matchUserAgent("iPod")},goog.labs.userAgent.platform.isIphone=function(){return goog.labs.userAgent.util.matchUserAgent("iPhone")&&!goog.labs.userAgent.util.matchUserAgent("iPod")&&!goog.labs.userAgent.util.matchUserAgent("iPad")},goog.labs.userAgent.platform.isIpad=function(){return goog.labs.userAgent.util.matchUserAgent("iPad")},goog.labs.userAgent.platform.isIos=function(){return goog.labs.userAgent.platform.isIphone()||goog.labs.userAgent.platform.isIpad()||goog.labs.userAgent.platform.isIpod()},goog.labs.userAgent.platform.isMacintosh=function(){return goog.labs.userAgent.util.matchUserAgent("Macintosh")},goog.labs.userAgent.platform.isLinux=function(){return goog.labs.userAgent.util.matchUserAgent("Linux")},goog.labs.userAgent.platform.isWindows=function(){return goog.labs.userAgent.util.matchUserAgent("Windows")},goog.labs.userAgent.platform.isChromeOS=function(){return goog.labs.userAgent.util.matchUserAgent("CrOS")},goog.labs.userAgent.platform.isChromecast=function(){return goog.labs.userAgent.util.matchUserAgent("CrKey")},goog.labs.userAgent.platform.isKaiOS=function(){return goog.labs.userAgent.util.matchUserAgentIgnoreCase("KaiOS")},goog.labs.userAgent.platform.isGo2Phone=function(){return goog.labs.userAgent.util.matchUserAgentIgnoreCase("GAFP")},goog.labs.userAgent.platform.getVersion=function(){var e=goog.labs.userAgent.util.getUserAgent(),t="";return goog.labs.userAgent.platform.isWindows()?t=(e=(t=/Windows (?:NT|Phone) ([0-9.]+)/).exec(e))?e[1]:"0.0":goog.labs.userAgent.platform.isIos()?t=(e=(t=/(?:iPhone|iPod|iPad|CPU)\s+OS\s+(\S+)/).exec(e))&&e[1].replace(/_/g,"."):goog.labs.userAgent.platform.isMacintosh()?t=(e=(t=/Mac OS X ([0-9_.]+)/).exec(e))?e[1].replace(/_/g,"."):"10":goog.labs.userAgent.platform.isKaiOS()?t=(e=(t=/(?:KaiOS)\/(\S+)/i).exec(e))&&e[1]:goog.labs.userAgent.platform.isAndroid()?t=(e=(t=/Android\s+([^\);]+)(\)|;)/).exec(e))&&e[1]:goog.labs.userAgent.platform.isChromeOS()&&(t=(e=(t=/(?:CrOS\s+(?:i686|x86_64)\s+([0-9.]+))/).exec(e))&&e[1]),t||""},goog.labs.userAgent.platform.isVersionOrHigher=function(e){return 0<=goog.string.compareVersions(goog.labs.userAgent.platform.getVersion(),e)},goog.reflect={},goog.reflect.object=function(e,t){return t},goog.reflect.objectProperty=function(e,t){return e},goog.reflect.sinkValue=function(e){return goog.reflect.sinkValue[" "](e),e},goog.reflect.sinkValue[" "]=goog.nullFunction,goog.reflect.canAccessProperty=function(e,t){try{return goog.reflect.sinkValue(e[t]),!0}catch(e){}return !1},goog.reflect.cache=function(e,t,o,r){return r=r?r(t):t,Object.prototype.hasOwnProperty.call(e,r)?e[r]:e[r]=o(t)},goog.labs.userAgent.engine={},goog.labs.userAgent.engine.isPresto=function(){return goog.labs.userAgent.util.matchUserAgent("Presto")},goog.labs.userAgent.engine.isTrident=function(){return goog.labs.userAgent.util.matchUserAgent("Trident")||goog.labs.userAgent.util.matchUserAgent("MSIE")},goog.labs.userAgent.engine.isEdge=function(){return goog.labs.userAgent.util.matchUserAgent("Edge")},goog.labs.userAgent.engine.isWebKit=function(){return goog.labs.userAgent.util.matchUserAgentIgnoreCase("WebKit")&&!goog.labs.userAgent.engine.isEdge()},goog.labs.userAgent.engine.isGecko=function(){return goog.labs.userAgent.util.matchUserAgent("Gecko")&&!goog.labs.userAgent.engine.isWebKit()&&!goog.labs.userAgent.engine.isTrident()&&!goog.labs.userAgent.engine.isEdge()},goog.labs.userAgent.engine.getVersion=function(){var e=goog.labs.userAgent.util.getUserAgent();if(e){e=goog.labs.userAgent.util.extractVersionTuples(e);var t,o=goog.labs.userAgent.engine.getEngineTuple_(e);if(o)return "Gecko"==o[0]?goog.labs.userAgent.engine.getVersionForKey_(e,"Firefox"):o[1];if((e=e[0])&&(t=e[2])&&(t=/Trident\/([^\s;]+)/.exec(t)))return t[1]}return ""},goog.labs.userAgent.engine.getEngineTuple_=function(e){if(!goog.labs.userAgent.engine.isEdge())return e[1];for(var t=0;t<e.length;t++){var o=e[t];if("Edge"==o[0])return o}},goog.labs.userAgent.engine.isVersionOrHigher=function(e){return 0<=goog.string.compareVersions(goog.labs.userAgent.engine.getVersion(),e)},goog.labs.userAgent.engine.getVersionForKey_=function(e,t){return (e=goog.array.find(e,(function(e){return t==e[0]})))&&e[1]||""},goog.userAgent={},goog.userAgent.ASSUME_IE=!1,goog.userAgent.ASSUME_EDGE=!1,goog.userAgent.ASSUME_GECKO=!1,goog.userAgent.ASSUME_WEBKIT=!1,goog.userAgent.ASSUME_MOBILE_WEBKIT=!1,goog.userAgent.ASSUME_OPERA=!1,goog.userAgent.ASSUME_ANY_VERSION=!1,goog.userAgent.BROWSER_KNOWN_=goog.userAgent.ASSUME_IE||goog.userAgent.ASSUME_EDGE||goog.userAgent.ASSUME_GECKO||goog.userAgent.ASSUME_MOBILE_WEBKIT||goog.userAgent.ASSUME_WEBKIT||goog.userAgent.ASSUME_OPERA,goog.userAgent.getUserAgentString=function(){return goog.labs.userAgent.util.getUserAgent()},goog.userAgent.getNavigatorTyped=function(){return goog.global.navigator||null},goog.userAgent.getNavigator=function(){return goog.userAgent.getNavigatorTyped()},goog.userAgent.OPERA=goog.userAgent.BROWSER_KNOWN_?goog.userAgent.ASSUME_OPERA:goog.labs.userAgent.browser.isOpera(),goog.userAgent.IE=goog.userAgent.BROWSER_KNOWN_?goog.userAgent.ASSUME_IE:goog.labs.userAgent.browser.isIE(),goog.userAgent.EDGE=goog.userAgent.BROWSER_KNOWN_?goog.userAgent.ASSUME_EDGE:goog.labs.userAgent.engine.isEdge(),goog.userAgent.EDGE_OR_IE=goog.userAgent.EDGE||goog.userAgent.IE,goog.userAgent.GECKO=goog.userAgent.BROWSER_KNOWN_?goog.userAgent.ASSUME_GECKO:goog.labs.userAgent.engine.isGecko();goog.userAgent.WEBKIT=goog.userAgent.BROWSER_KNOWN_?goog.userAgent.ASSUME_WEBKIT||goog.userAgent.ASSUME_MOBILE_WEBKIT:goog.labs.userAgent.engine.isWebKit(),goog.userAgent.isMobile_=function(){return goog.userAgent.WEBKIT&&goog.labs.userAgent.util.matchUserAgent("Mobile")},goog.userAgent.MOBILE=goog.userAgent.ASSUME_MOBILE_WEBKIT||goog.userAgent.isMobile_(),goog.userAgent.SAFARI=goog.userAgent.WEBKIT,goog.userAgent.determinePlatform_=function(){var e=goog.userAgent.getNavigatorTyped();return e&&e.platform||""},goog.userAgent.PLATFORM=goog.userAgent.determinePlatform_(),goog.userAgent.ASSUME_MAC=!1,goog.userAgent.ASSUME_WINDOWS=!1,goog.userAgent.ASSUME_LINUX=!1,goog.userAgent.ASSUME_X11=!1,goog.userAgent.ASSUME_ANDROID=!1,goog.userAgent.ASSUME_IPHONE=!1,goog.userAgent.ASSUME_IPAD=!1,goog.userAgent.ASSUME_IPOD=!1,goog.userAgent.ASSUME_KAIOS=!1,goog.userAgent.ASSUME_GO2PHONE=!1,goog.userAgent.PLATFORM_KNOWN_=goog.userAgent.ASSUME_MAC||goog.userAgent.ASSUME_WINDOWS||goog.userAgent.ASSUME_LINUX||goog.userAgent.ASSUME_X11||goog.userAgent.ASSUME_ANDROID||goog.userAgent.ASSUME_IPHONE||goog.userAgent.ASSUME_IPAD||goog.userAgent.ASSUME_IPOD,goog.userAgent.MAC=goog.userAgent.PLATFORM_KNOWN_?goog.userAgent.ASSUME_MAC:goog.labs.userAgent.platform.isMacintosh(),goog.userAgent.WINDOWS=goog.userAgent.PLATFORM_KNOWN_?goog.userAgent.ASSUME_WINDOWS:goog.labs.userAgent.platform.isWindows(),goog.userAgent.isLegacyLinux_=function(){return goog.labs.userAgent.platform.isLinux()||goog.labs.userAgent.platform.isChromeOS()},goog.userAgent.LINUX=goog.userAgent.PLATFORM_KNOWN_?goog.userAgent.ASSUME_LINUX:goog.userAgent.isLegacyLinux_(),goog.userAgent.isX11_=function(){var e=goog.userAgent.getNavigatorTyped();return !!e&&goog.string.contains(e.appVersion||"","X11")},goog.userAgent.X11=goog.userAgent.PLATFORM_KNOWN_?goog.userAgent.ASSUME_X11:goog.userAgent.isX11_(),goog.userAgent.ANDROID=goog.userAgent.PLATFORM_KNOWN_?goog.userAgent.ASSUME_ANDROID:goog.labs.userAgent.platform.isAndroid(),goog.userAgent.IPHONE=goog.userAgent.PLATFORM_KNOWN_?goog.userAgent.ASSUME_IPHONE:goog.labs.userAgent.platform.isIphone(),goog.userAgent.IPAD=goog.userAgent.PLATFORM_KNOWN_?goog.userAgent.ASSUME_IPAD:goog.labs.userAgent.platform.isIpad(),goog.userAgent.IPOD=goog.userAgent.PLATFORM_KNOWN_?goog.userAgent.ASSUME_IPOD:goog.labs.userAgent.platform.isIpod(),goog.userAgent.IOS=goog.userAgent.PLATFORM_KNOWN_?goog.userAgent.ASSUME_IPHONE||goog.userAgent.ASSUME_IPAD||goog.userAgent.ASSUME_IPOD:goog.labs.userAgent.platform.isIos(),goog.userAgent.KAIOS=goog.userAgent.PLATFORM_KNOWN_?goog.userAgent.ASSUME_KAIOS:goog.labs.userAgent.platform.isKaiOS(),goog.userAgent.GO2PHONE=goog.userAgent.PLATFORM_KNOWN_?goog.userAgent.ASSUME_GO2PHONE:goog.labs.userAgent.platform.isGo2Phone(),goog.userAgent.determineVersion_=function(){var e="",t=goog.userAgent.getVersionRegexResult_();return t&&(e=t?t[1]:""),goog.userAgent.IE&&(null!=(t=goog.userAgent.getDocumentMode_())&&t>parseFloat(e))?String(t):e},goog.userAgent.getVersionRegexResult_=function(){var e=goog.userAgent.getUserAgentString();return goog.userAgent.GECKO?/rv:([^\);]+)(\)|;)/.exec(e):goog.userAgent.EDGE?/Edge\/([\d\.]+)/.exec(e):goog.userAgent.IE?/\b(?:MSIE|rv)[: ]([^\);]+)(\)|;)/.exec(e):goog.userAgent.WEBKIT?/WebKit\/(\S+)/.exec(e):goog.userAgent.OPERA?/(?:Version)[ \/]?(\S+)/.exec(e):void 0},goog.userAgent.getDocumentMode_=function(){var e=goog.global.document;return e?e.documentMode:void 0},goog.userAgent.VERSION=goog.userAgent.determineVersion_(),goog.userAgent.compare=function(e,t){return goog.string.compareVersions(e,t)},goog.userAgent.isVersionOrHigherCache_={},goog.userAgent.isVersionOrHigher=function(e){return goog.userAgent.ASSUME_ANY_VERSION||goog.reflect.cache(goog.userAgent.isVersionOrHigherCache_,e,(function(){return 0<=goog.string.compareVersions(goog.userAgent.VERSION,e)}))},goog.userAgent.isVersion=goog.userAgent.isVersionOrHigher,goog.userAgent.isDocumentModeOrHigher=function(e){return Number(goog.userAgent.DOCUMENT_MODE)>=e},goog.userAgent.isDocumentMode=goog.userAgent.isDocumentModeOrHigher,goog.userAgent.DOCUMENT_MODE=function(){if(goog.global.document&&goog.userAgent.IE)return goog.userAgent.getDocumentMode_()}(),goog.userAgent.product={},goog.userAgent.product.ASSUME_FIREFOX=!1,goog.userAgent.product.ASSUME_IPHONE=!1,goog.userAgent.product.ASSUME_IPAD=!1,goog.userAgent.product.ASSUME_ANDROID=!1,goog.userAgent.product.ASSUME_CHROME=!1,goog.userAgent.product.ASSUME_SAFARI=!1,goog.userAgent.product.PRODUCT_KNOWN_=goog.userAgent.ASSUME_IE||goog.userAgent.ASSUME_EDGE||goog.userAgent.ASSUME_OPERA||goog.userAgent.product.ASSUME_FIREFOX||goog.userAgent.product.ASSUME_IPHONE||goog.userAgent.product.ASSUME_IPAD||goog.userAgent.product.ASSUME_ANDROID||goog.userAgent.product.ASSUME_CHROME||goog.userAgent.product.ASSUME_SAFARI,goog.userAgent.product.OPERA=goog.userAgent.OPERA,goog.userAgent.product.IE=goog.userAgent.IE,goog.userAgent.product.EDGE=goog.userAgent.EDGE,goog.userAgent.product.FIREFOX=goog.userAgent.product.PRODUCT_KNOWN_?goog.userAgent.product.ASSUME_FIREFOX:goog.labs.userAgent.browser.isFirefox(),goog.userAgent.product.isIphoneOrIpod_=function(){return goog.labs.userAgent.platform.isIphone()||goog.labs.userAgent.platform.isIpod()},goog.userAgent.product.IPHONE=goog.userAgent.product.PRODUCT_KNOWN_?goog.userAgent.product.ASSUME_IPHONE:goog.userAgent.product.isIphoneOrIpod_(),goog.userAgent.product.IPAD=goog.userAgent.product.PRODUCT_KNOWN_?goog.userAgent.product.ASSUME_IPAD:goog.labs.userAgent.platform.isIpad(),goog.userAgent.product.ANDROID=goog.userAgent.product.PRODUCT_KNOWN_?goog.userAgent.product.ASSUME_ANDROID:goog.labs.userAgent.browser.isAndroidBrowser(),goog.userAgent.product.CHROME=goog.userAgent.product.PRODUCT_KNOWN_?goog.userAgent.product.ASSUME_CHROME:goog.labs.userAgent.browser.isChrome(),goog.userAgent.product.isSafariDesktop_=function(){return goog.labs.userAgent.browser.isSafari()&&!goog.labs.userAgent.platform.isIos()},goog.userAgent.product.SAFARI=goog.userAgent.product.PRODUCT_KNOWN_?goog.userAgent.product.ASSUME_SAFARI:goog.userAgent.product.isSafariDesktop_(),goog.crypt.base64={},goog.crypt.base64.DEFAULT_ALPHABET_COMMON_="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",goog.crypt.base64.ENCODED_VALS=goog.crypt.base64.DEFAULT_ALPHABET_COMMON_+"+/=",goog.crypt.base64.ENCODED_VALS_WEBSAFE=goog.crypt.base64.DEFAULT_ALPHABET_COMMON_+"-_.",goog.crypt.base64.Alphabet={DEFAULT:0,NO_PADDING:1,WEBSAFE:2,WEBSAFE_DOT_PADDING:3,WEBSAFE_NO_PADDING:4},goog.crypt.base64.paddingChars_="=.",goog.crypt.base64.isPadding_=function(e){return goog.string.contains(goog.crypt.base64.paddingChars_,e)},goog.crypt.base64.byteToCharMaps_={},goog.crypt.base64.charToByteMap_=null,goog.crypt.base64.ASSUME_NATIVE_SUPPORT_=goog.userAgent.GECKO||goog.userAgent.WEBKIT&&!goog.userAgent.product.SAFARI||goog.userAgent.OPERA,goog.crypt.base64.HAS_NATIVE_ENCODE_=goog.crypt.base64.ASSUME_NATIVE_SUPPORT_||"function"==typeof goog.global.btoa,goog.crypt.base64.HAS_NATIVE_DECODE_=goog.crypt.base64.ASSUME_NATIVE_SUPPORT_||!goog.userAgent.product.SAFARI&&!goog.userAgent.IE&&"function"==typeof goog.global.atob,goog.crypt.base64.encodeByteArray=function(e,t){goog.asserts.assert(goog.isArrayLike(e),"encodeByteArray takes an array as a parameter"),void 0===t&&(t=goog.crypt.base64.Alphabet.DEFAULT),goog.crypt.base64.init_(),t=goog.crypt.base64.byteToCharMaps_[t];for(var o=[],r=0;r<e.length;r+=3){var s=e[r],n=r+1<e.length,i=n?e[r+1]:0,a=r+2<e.length,g=a?e[r+2]:0,l=s>>2;s=(3&s)<<4|i>>4,i=(15&i)<<2|g>>6,g&=63,a||(g=64,n||(i=64)),o.push(t[l],t[s],t[i]||"",t[g]||"");}return o.join("")},goog.crypt.base64.encodeString=function(e,t){return goog.crypt.base64.HAS_NATIVE_ENCODE_&&!t?goog.global.btoa(e):goog.crypt.base64.encodeByteArray(goog.crypt.stringToByteArray(e),t)},goog.crypt.base64.decodeString=function(e,t){if(goog.crypt.base64.HAS_NATIVE_DECODE_&&!t)return goog.global.atob(e);var o="";return goog.crypt.base64.decodeStringInternal_(e,(function(e){o+=String.fromCharCode(e);})),o},goog.crypt.base64.decodeStringToByteArray=function(e,t){var o=[];return goog.crypt.base64.decodeStringInternal_(e,(function(e){o.push(e);})),o},goog.crypt.base64.decodeStringToUint8Array=function(e){goog.asserts.assert(!goog.userAgent.IE||goog.userAgent.isVersionOrHigher("10"),"Browser does not support typed arrays");var t=e.length,o=3*t/4;o%3?o=Math.floor(o):goog.crypt.base64.isPadding_(e[t-1])&&(o=goog.crypt.base64.isPadding_(e[t-2])?o-2:o-1);var r=new Uint8Array(o),s=0;return goog.crypt.base64.decodeStringInternal_(e,(function(e){r[s++]=e;})),r.subarray(0,s)},goog.crypt.base64.decodeStringInternal_=function(e,t){function o(t){for(;r<e.length;){var o=e.charAt(r++),s=goog.crypt.base64.charToByteMap_[o];if(null!=s)return s;if(!goog.string.isEmptyOrWhitespace(o))throw Error("Unknown base64 encoding at char: "+o)}return t}goog.crypt.base64.init_();for(var r=0;;){var s=o(-1),n=o(0),i=o(64),a=o(64);if(64===a&&-1===s)break;t(s<<2|n>>4),64!=i&&(t(n<<4&240|i>>2),64!=a&&t(i<<6&192|a));}},goog.crypt.base64.init_=function(){if(!goog.crypt.base64.charToByteMap_){goog.crypt.base64.charToByteMap_={};for(var e=goog.crypt.base64.DEFAULT_ALPHABET_COMMON_.split(""),t=["+/=","+/","-_=","-_.","-_"],o=0;5>o;o++){var r=e.concat(t[o].split(""));goog.crypt.base64.byteToCharMaps_[o]=r;for(var s=0;s<r.length;s++){var n=r[s],i=goog.crypt.base64.charToByteMap_[n];void 0===i?goog.crypt.base64.charToByteMap_[n]=s:goog.asserts.assert(i===s);}}}},jspb.utils={},jspb.utils.split64Low=0,jspb.utils.split64High=0,jspb.utils.splitUint64=function(e){var t=e>>>0;e=Math.floor((e-t)/jspb.BinaryConstants.TWO_TO_32)>>>0,jspb.utils.split64Low=t,jspb.utils.split64High=e;},jspb.utils.splitInt64=function(e){var t=0>e,o=(e=Math.abs(e))>>>0;e=Math.floor((e-o)/jspb.BinaryConstants.TWO_TO_32),e>>>=0,t&&(e=~e>>>0,4294967295<(o=1+(~o>>>0))&&(o=0,4294967295<++e&&(e=0))),jspb.utils.split64Low=o,jspb.utils.split64High=e;},jspb.utils.splitZigzag64=function(e){var t=0>e;e=2*Math.abs(e),jspb.utils.splitUint64(e),e=jspb.utils.split64Low;var o=jspb.utils.split64High;t&&(0==e?0==o?o=e=4294967295:(o--,e=4294967295):e--),jspb.utils.split64Low=e,jspb.utils.split64High=o;},jspb.utils.splitFloat32=function(e){var t=0>e?1:0;if(0===(e=t?-e:e))0<1/e?(jspb.utils.split64High=0,jspb.utils.split64Low=0):(jspb.utils.split64High=0,jspb.utils.split64Low=2147483648);else if(isNaN(e))jspb.utils.split64High=0,jspb.utils.split64Low=2147483647;else if(e>jspb.BinaryConstants.FLOAT32_MAX)jspb.utils.split64High=0,jspb.utils.split64Low=(t<<31|2139095040)>>>0;else if(e<jspb.BinaryConstants.FLOAT32_MIN)e=Math.round(e/Math.pow(2,-149)),jspb.utils.split64High=0,jspb.utils.split64Low=(t<<31|e)>>>0;else {var o=Math.floor(Math.log(e)/Math.LN2);e*=Math.pow(2,-o),e=8388607&Math.round(e*jspb.BinaryConstants.TWO_TO_23),jspb.utils.split64High=0,jspb.utils.split64Low=(t<<31|o+127<<23|e)>>>0;}},jspb.utils.splitFloat64=function(e){var t=0>e?1:0;if(0===(e=t?-e:e))jspb.utils.split64High=0<1/e?0:2147483648,jspb.utils.split64Low=0;else if(isNaN(e))jspb.utils.split64High=2147483647,jspb.utils.split64Low=4294967295;else if(e>jspb.BinaryConstants.FLOAT64_MAX)jspb.utils.split64High=(t<<31|2146435072)>>>0,jspb.utils.split64Low=0;else if(e<jspb.BinaryConstants.FLOAT64_MIN){var o=e/Math.pow(2,-1074);e=o/jspb.BinaryConstants.TWO_TO_32,jspb.utils.split64High=(t<<31|e)>>>0,jspb.utils.split64Low=o>>>0;}else {var r=0;if(2<=(o=e))for(;2<=o&&1023>r;)r++,o/=2;else for(;1>o&&-1022<r;)o*=2,r--;e=(o=e*Math.pow(2,-r))*jspb.BinaryConstants.TWO_TO_20&1048575,o=o*jspb.BinaryConstants.TWO_TO_52>>>0,jspb.utils.split64High=(t<<31|r+1023<<20|e)>>>0,jspb.utils.split64Low=o;}},jspb.utils.splitHash64=function(e){var t=e.charCodeAt(0),o=e.charCodeAt(1),r=e.charCodeAt(2),s=e.charCodeAt(3),n=e.charCodeAt(4),i=e.charCodeAt(5),a=e.charCodeAt(6);e=e.charCodeAt(7),jspb.utils.split64Low=t+(o<<8)+(r<<16)+(s<<24)>>>0,jspb.utils.split64High=n+(i<<8)+(a<<16)+(e<<24)>>>0;},jspb.utils.joinUint64=function(e,t){return t*jspb.BinaryConstants.TWO_TO_32+(e>>>0)},jspb.utils.joinInt64=function(e,t){var o=2147483648&t;return o&&(t=~t>>>0,0==(e=1+~e>>>0)&&(t=t+1>>>0)),e=jspb.utils.joinUint64(e,t),o?-e:e},jspb.utils.toZigzag64=function(e,t,o){var r=t>>31;return o(e<<1^r,(t<<1|e>>>31)^r)},jspb.utils.joinZigzag64=function(e,t){return jspb.utils.fromZigzag64(e,t,jspb.utils.joinInt64)},jspb.utils.fromZigzag64=function(e,t,o){var r=-(1&e);return o((e>>>1|t<<31)^r,t>>>1^r)},jspb.utils.joinFloat32=function(e,t){t=2*(e>>31)+1;var o=e>>>23&255;return e&=8388607,255==o?e?NaN:1/0*t:0==o?t*Math.pow(2,-149)*e:t*Math.pow(2,o-150)*(e+Math.pow(2,23))},jspb.utils.joinFloat64=function(e,t){var o=2*(t>>31)+1,r=t>>>20&2047;return e=jspb.BinaryConstants.TWO_TO_32*(1048575&t)+e,2047==r?e?NaN:1/0*o:0==r?o*Math.pow(2,-1074)*e:o*Math.pow(2,r-1075)*(e+jspb.BinaryConstants.TWO_TO_52)},jspb.utils.joinHash64=function(e,t){return String.fromCharCode(e>>>0&255,e>>>8&255,e>>>16&255,e>>>24&255,t>>>0&255,t>>>8&255,t>>>16&255,t>>>24&255)},jspb.utils.DIGITS="0123456789abcdef".split(""),jspb.utils.ZERO_CHAR_CODE_=48,jspb.utils.A_CHAR_CODE_=97,jspb.utils.joinUnsignedDecimalString=function(e,t){function o(e,t){return e=e?String(e):"",t?"0000000".slice(e.length)+e:e}if(2097151>=t)return ""+(jspb.BinaryConstants.TWO_TO_32*t+e);var r=(e>>>24|t<<8)>>>0&16777215;return e=(16777215&e)+6777216*r+6710656*(t=t>>16&65535),r+=8147497*t,t*=2,1e7<=e&&(r+=Math.floor(e/1e7),e%=1e7),1e7<=r&&(t+=Math.floor(r/1e7),r%=1e7),o(t,0)+o(r,t)+o(e,1)},jspb.utils.joinSignedDecimalString=function(e,t){var o=2147483648&t;return o&&(t=~t+(0==(e=1+~e>>>0)?1:0)>>>0),e=jspb.utils.joinUnsignedDecimalString(e,t),o?"-"+e:e},jspb.utils.hash64ToDecimalString=function(e,t){jspb.utils.splitHash64(e),e=jspb.utils.split64Low;var o=jspb.utils.split64High;return t?jspb.utils.joinSignedDecimalString(e,o):jspb.utils.joinUnsignedDecimalString(e,o)},jspb.utils.hash64ArrayToDecimalStrings=function(e,t){for(var o=Array(e.length),r=0;r<e.length;r++)o[r]=jspb.utils.hash64ToDecimalString(e[r],t);return o},jspb.utils.decimalStringToHash64=function(e){function t(e,t){for(var o=0;8>o&&(1!==e||0<t);o++)t=e*r[o]+t,r[o]=255&t,t>>>=8;}goog.asserts.assert(0<e.length);var o=!1;"-"===e[0]&&(o=!0,e=e.slice(1));for(var r=[0,0,0,0,0,0,0,0],s=0;s<e.length;s++)t(10,e.charCodeAt(s)-jspb.utils.ZERO_CHAR_CODE_);return o&&(function(){for(var e=0;8>e;e++)r[e]=255&~r[e];}(),t(1,1)),goog.crypt.byteArrayToString(r)},jspb.utils.splitDecimalString=function(e){jspb.utils.splitHash64(jspb.utils.decimalStringToHash64(e));},jspb.utils.toHexDigit_=function(e){return String.fromCharCode(10>e?jspb.utils.ZERO_CHAR_CODE_+e:jspb.utils.A_CHAR_CODE_-10+e)},jspb.utils.fromHexCharCode_=function(e){return e>=jspb.utils.A_CHAR_CODE_?e-jspb.utils.A_CHAR_CODE_+10:e-jspb.utils.ZERO_CHAR_CODE_},jspb.utils.hash64ToHexString=function(e){var t=Array(18);t[0]="0",t[1]="x";for(var o=0;8>o;o++){var r=e.charCodeAt(7-o);t[2*o+2]=jspb.utils.toHexDigit_(r>>4),t[2*o+3]=jspb.utils.toHexDigit_(15&r);}return t.join("")},jspb.utils.hexStringToHash64=function(e){e=e.toLowerCase(),goog.asserts.assert(18==e.length),goog.asserts.assert("0"==e[0]),goog.asserts.assert("x"==e[1]);for(var t="",o=0;8>o;o++){var r=jspb.utils.fromHexCharCode_(e.charCodeAt(2*o+2)),s=jspb.utils.fromHexCharCode_(e.charCodeAt(2*o+3));t=String.fromCharCode(16*r+s)+t;}return t},jspb.utils.hash64ToNumber=function(e,t){jspb.utils.splitHash64(e),e=jspb.utils.split64Low;var o=jspb.utils.split64High;return t?jspb.utils.joinInt64(e,o):jspb.utils.joinUint64(e,o)},jspb.utils.numberToHash64=function(e){return jspb.utils.splitInt64(e),jspb.utils.joinHash64(jspb.utils.split64Low,jspb.utils.split64High)},jspb.utils.countVarints=function(e,t,o){for(var r=0,s=t;s<o;s++)r+=e[s]>>7;return o-t-r},jspb.utils.countVarintFields=function(e,t,o,r){var s=0;if(128>(r=8*r+jspb.BinaryConstants.WireType.VARINT))for(;t<o&&e[t++]==r;)for(s++;;){var n=e[t++];if(0==(128&n))break}else for(;t<o;){for(n=r;128<n;){if(e[t]!=(127&n|128))return s;t++,n>>=7;}if(e[t++]!=n)break;for(s++;0!=(128&(n=e[t++])););}return s},jspb.utils.countFixedFields_=function(e,t,o,r,s){var n=0;if(128>r)for(;t<o&&e[t++]==r;)n++,t+=s;else for(;t<o;){for(var i=r;128<i;){if(e[t++]!=(127&i|128))return n;i>>=7;}if(e[t++]!=i)break;n++,t+=s;}return n},jspb.utils.countFixed32Fields=function(e,t,o,r){return jspb.utils.countFixedFields_(e,t,o,8*r+jspb.BinaryConstants.WireType.FIXED32,4)},jspb.utils.countFixed64Fields=function(e,t,o,r){return jspb.utils.countFixedFields_(e,t,o,8*r+jspb.BinaryConstants.WireType.FIXED64,8)},jspb.utils.countDelimitedFields=function(e,t,o,r){var s=0;for(r=8*r+jspb.BinaryConstants.WireType.DELIMITED;t<o;){for(var n=r;128<n;){if(e[t++]!=(127&n|128))return s;n>>=7;}if(e[t++]!=n)break;s++;for(var i=0,a=1;i+=(127&(n=e[t++]))*a,a*=128,0!=(128&n););t+=i;}return s},jspb.utils.debugBytesToTextFormat=function(e){var t='"';if(e){e=jspb.utils.byteSourceToUint8Array(e);for(var o=0;o<e.length;o++)t+="\\x",16>e[o]&&(t+="0"),t+=e[o].toString(16);}return t+'"'},jspb.utils.debugScalarToTextFormat=function(e){return "string"==typeof e?goog.string.quote(e):e.toString()},jspb.utils.stringToByteArray=function(e){for(var t=new Uint8Array(e.length),o=0;o<e.length;o++){var r=e.charCodeAt(o);if(255<r)throw Error("Conversion error: string contains codepoint outside of byte range");t[o]=r;}return t},jspb.utils.byteSourceToUint8Array=function(e){return e.constructor===Uint8Array?e:e.constructor===ArrayBuffer||"undefined"!=typeof Buffer&&e.constructor===Buffer||e.constructor===Array?new Uint8Array(e):e.constructor===String?goog.crypt.base64.decodeStringToUint8Array(e):(goog.asserts.fail("Type not convertible to Uint8Array."),new Uint8Array(0))},jspb.BinaryDecoder=function(e,t,o){this.bytes_=null,this.cursor_=this.end_=this.start_=0,this.error_=!1,e&&this.setBlock(e,t,o);},jspb.BinaryDecoder.instanceCache_=[],jspb.BinaryDecoder.alloc=function(e,t,o){if(jspb.BinaryDecoder.instanceCache_.length){var r=jspb.BinaryDecoder.instanceCache_.pop();return e&&r.setBlock(e,t,o),r}return new jspb.BinaryDecoder(e,t,o)},jspb.BinaryDecoder.prototype.free=function(){this.clear(),100>jspb.BinaryDecoder.instanceCache_.length&&jspb.BinaryDecoder.instanceCache_.push(this);},jspb.BinaryDecoder.prototype.clone=function(){return jspb.BinaryDecoder.alloc(this.bytes_,this.start_,this.end_-this.start_)},jspb.BinaryDecoder.prototype.clear=function(){this.bytes_=null,this.cursor_=this.end_=this.start_=0,this.error_=!1;},jspb.BinaryDecoder.prototype.getBuffer=function(){return this.bytes_},jspb.BinaryDecoder.prototype.setBlock=function(e,t,o){this.bytes_=jspb.utils.byteSourceToUint8Array(e),this.start_=void 0!==t?t:0,this.end_=void 0!==o?this.start_+o:this.bytes_.length,this.cursor_=this.start_;},jspb.BinaryDecoder.prototype.getEnd=function(){return this.end_},jspb.BinaryDecoder.prototype.setEnd=function(e){this.end_=e;},jspb.BinaryDecoder.prototype.reset=function(){this.cursor_=this.start_;},jspb.BinaryDecoder.prototype.getCursor=function(){return this.cursor_},jspb.BinaryDecoder.prototype.setCursor=function(e){this.cursor_=e;},jspb.BinaryDecoder.prototype.advance=function(e){this.cursor_+=e,goog.asserts.assert(this.cursor_<=this.end_);},jspb.BinaryDecoder.prototype.atEnd=function(){return this.cursor_==this.end_},jspb.BinaryDecoder.prototype.pastEnd=function(){return this.cursor_>this.end_},jspb.BinaryDecoder.prototype.getError=function(){return this.error_||0>this.cursor_||this.cursor_>this.end_},jspb.BinaryDecoder.prototype.readSplitVarint64=function(e){for(var t=128,o=0,r=0,s=0;4>s&&128<=t;s++)o|=(127&(t=this.bytes_[this.cursor_++]))<<7*s;if(128<=t&&(o|=(127&(t=this.bytes_[this.cursor_++]))<<28,r|=(127&t)>>4),128<=t)for(s=0;5>s&&128<=t;s++)r|=(127&(t=this.bytes_[this.cursor_++]))<<7*s+3;if(128>t)return e(o>>>0,r>>>0);goog.asserts.fail("Failed to read varint, encoding is invalid."),this.error_=!0;},jspb.BinaryDecoder.prototype.readSplitZigzagVarint64=function(e){return this.readSplitVarint64((function(t,o){return jspb.utils.fromZigzag64(t,o,e)}))},jspb.BinaryDecoder.prototype.readSplitFixed64=function(e){var t=this.bytes_,o=this.cursor_;this.cursor_+=8;for(var r=0,s=0,n=o+7;n>=o;n--)r=r<<8|t[n],s=s<<8|t[n+4];return e(r,s)},jspb.BinaryDecoder.prototype.skipVarint=function(){for(;128&this.bytes_[this.cursor_];)this.cursor_++;this.cursor_++;},jspb.BinaryDecoder.prototype.unskipVarint=function(e){for(;128<e;)this.cursor_--,e>>>=7;this.cursor_--;},jspb.BinaryDecoder.prototype.readUnsignedVarint32=function(){var e=this.bytes_,t=e[this.cursor_+0],o=127&t;return 128>t?(this.cursor_+=1,goog.asserts.assert(this.cursor_<=this.end_),o):(o|=(127&(t=e[this.cursor_+1]))<<7,128>t?(this.cursor_+=2,goog.asserts.assert(this.cursor_<=this.end_),o):(o|=(127&(t=e[this.cursor_+2]))<<14,128>t?(this.cursor_+=3,goog.asserts.assert(this.cursor_<=this.end_),o):(o|=(127&(t=e[this.cursor_+3]))<<21,128>t?(this.cursor_+=4,goog.asserts.assert(this.cursor_<=this.end_),o):(o|=(15&(t=e[this.cursor_+4]))<<28,128>t?(this.cursor_+=5,goog.asserts.assert(this.cursor_<=this.end_),o>>>0):(this.cursor_+=5,128<=e[this.cursor_++]&&128<=e[this.cursor_++]&&128<=e[this.cursor_++]&&128<=e[this.cursor_++]&&128<=e[this.cursor_++]&&goog.asserts.assert(!1),goog.asserts.assert(this.cursor_<=this.end_),o)))))},jspb.BinaryDecoder.prototype.readSignedVarint32=jspb.BinaryDecoder.prototype.readUnsignedVarint32,jspb.BinaryDecoder.prototype.readUnsignedVarint32String=function(){return this.readUnsignedVarint32().toString()},jspb.BinaryDecoder.prototype.readSignedVarint32String=function(){return this.readSignedVarint32().toString()},jspb.BinaryDecoder.prototype.readZigzagVarint32=function(){var e=this.readUnsignedVarint32();return e>>>1^-(1&e)},jspb.BinaryDecoder.prototype.readUnsignedVarint64=function(){return this.readSplitVarint64(jspb.utils.joinUint64)},jspb.BinaryDecoder.prototype.readUnsignedVarint64String=function(){return this.readSplitVarint64(jspb.utils.joinUnsignedDecimalString)},jspb.BinaryDecoder.prototype.readSignedVarint64=function(){return this.readSplitVarint64(jspb.utils.joinInt64)},jspb.BinaryDecoder.prototype.readSignedVarint64String=function(){return this.readSplitVarint64(jspb.utils.joinSignedDecimalString)},jspb.BinaryDecoder.prototype.readZigzagVarint64=function(){return this.readSplitVarint64(jspb.utils.joinZigzag64)},jspb.BinaryDecoder.prototype.readZigzagVarintHash64=function(){return this.readSplitZigzagVarint64(jspb.utils.joinHash64)},jspb.BinaryDecoder.prototype.readZigzagVarint64String=function(){return this.readSplitZigzagVarint64(jspb.utils.joinSignedDecimalString)},jspb.BinaryDecoder.prototype.readUint8=function(){var e=this.bytes_[this.cursor_+0];return this.cursor_+=1,goog.asserts.assert(this.cursor_<=this.end_),e},jspb.BinaryDecoder.prototype.readUint16=function(){var e=this.bytes_[this.cursor_+0],t=this.bytes_[this.cursor_+1];return this.cursor_+=2,goog.asserts.assert(this.cursor_<=this.end_),e<<0|t<<8},jspb.BinaryDecoder.prototype.readUint32=function(){var e=this.bytes_[this.cursor_+0],t=this.bytes_[this.cursor_+1],o=this.bytes_[this.cursor_+2],r=this.bytes_[this.cursor_+3];return this.cursor_+=4,goog.asserts.assert(this.cursor_<=this.end_),(e<<0|t<<8|o<<16|r<<24)>>>0},jspb.BinaryDecoder.prototype.readUint64=function(){var e=this.readUint32(),t=this.readUint32();return jspb.utils.joinUint64(e,t)},jspb.BinaryDecoder.prototype.readUint64String=function(){var e=this.readUint32(),t=this.readUint32();return jspb.utils.joinUnsignedDecimalString(e,t)},jspb.BinaryDecoder.prototype.readInt8=function(){var e=this.bytes_[this.cursor_+0];return this.cursor_+=1,goog.asserts.assert(this.cursor_<=this.end_),e<<24>>24},jspb.BinaryDecoder.prototype.readInt16=function(){var e=this.bytes_[this.cursor_+0],t=this.bytes_[this.cursor_+1];return this.cursor_+=2,goog.asserts.assert(this.cursor_<=this.end_),(e<<0|t<<8)<<16>>16},jspb.BinaryDecoder.prototype.readInt32=function(){var e=this.bytes_[this.cursor_+0],t=this.bytes_[this.cursor_+1],o=this.bytes_[this.cursor_+2],r=this.bytes_[this.cursor_+3];return this.cursor_+=4,goog.asserts.assert(this.cursor_<=this.end_),e<<0|t<<8|o<<16|r<<24},jspb.BinaryDecoder.prototype.readInt64=function(){var e=this.readUint32(),t=this.readUint32();return jspb.utils.joinInt64(e,t)},jspb.BinaryDecoder.prototype.readInt64String=function(){var e=this.readUint32(),t=this.readUint32();return jspb.utils.joinSignedDecimalString(e,t)},jspb.BinaryDecoder.prototype.readFloat=function(){var e=this.readUint32();return jspb.utils.joinFloat32(e,0)},jspb.BinaryDecoder.prototype.readDouble=function(){var e=this.readUint32(),t=this.readUint32();return jspb.utils.joinFloat64(e,t)},jspb.BinaryDecoder.prototype.readBool=function(){return !!this.bytes_[this.cursor_++]},jspb.BinaryDecoder.prototype.readEnum=function(){return this.readSignedVarint32()},jspb.BinaryDecoder.prototype.readString=function(e){var t=this.bytes_,o=this.cursor_;e=o+e;for(var r=[],s="";o<e;){var n=t[o++];if(128>n)r.push(n);else {if(192>n)continue;if(224>n){var i=t[o++];r.push((31&n)<<6|63&i);}else if(240>n){i=t[o++];var a=t[o++];r.push((15&n)<<12|(63&i)<<6|63&a);}else if(248>n){n=(7&n)<<18|(63&(i=t[o++]))<<12|(63&(a=t[o++]))<<6|63&t[o++],n-=65536,r.push(55296+(n>>10&1023),56320+(1023&n));}}8192<=r.length&&(s+=String.fromCharCode.apply(null,r),r.length=0);}return s+=goog.crypt.byteArrayToString(r),this.cursor_=o,s},jspb.BinaryDecoder.prototype.readStringWithLength=function(){var e=this.readUnsignedVarint32();return this.readString(e)},jspb.BinaryDecoder.prototype.readBytes=function(e){if(0>e||this.cursor_+e>this.bytes_.length)return this.error_=!0,goog.asserts.fail("Invalid byte length!"),new Uint8Array(0);var t=this.bytes_.subarray(this.cursor_,this.cursor_+e);return this.cursor_+=e,goog.asserts.assert(this.cursor_<=this.end_),t},jspb.BinaryDecoder.prototype.readVarintHash64=function(){return this.readSplitVarint64(jspb.utils.joinHash64)},jspb.BinaryDecoder.prototype.readFixedHash64=function(){var e=this.bytes_,t=this.cursor_,o=e[t+0],r=e[t+1],s=e[t+2],n=e[t+3],i=e[t+4],a=e[t+5],g=e[t+6];return e=e[t+7],this.cursor_+=8,String.fromCharCode(o,r,s,n,i,a,g,e)},jspb.BinaryReader=function(e,t,o){this.decoder_=jspb.BinaryDecoder.alloc(e,t,o),this.fieldCursor_=this.decoder_.getCursor(),this.nextField_=jspb.BinaryConstants.INVALID_FIELD_NUMBER,this.nextWireType_=jspb.BinaryConstants.WireType.INVALID,this.error_=!1,this.readCallbacks_=null;},jspb.BinaryReader.instanceCache_=[],jspb.BinaryReader.alloc=function(e,t,o){if(jspb.BinaryReader.instanceCache_.length){var r=jspb.BinaryReader.instanceCache_.pop();return e&&r.decoder_.setBlock(e,t,o),r}return new jspb.BinaryReader(e,t,o)},jspb.BinaryReader.prototype.alloc=jspb.BinaryReader.alloc,jspb.BinaryReader.prototype.free=function(){this.decoder_.clear(),this.nextField_=jspb.BinaryConstants.INVALID_FIELD_NUMBER,this.nextWireType_=jspb.BinaryConstants.WireType.INVALID,this.error_=!1,this.readCallbacks_=null,100>jspb.BinaryReader.instanceCache_.length&&jspb.BinaryReader.instanceCache_.push(this);},jspb.BinaryReader.prototype.getFieldCursor=function(){return this.fieldCursor_},jspb.BinaryReader.prototype.getCursor=function(){return this.decoder_.getCursor()},jspb.BinaryReader.prototype.getBuffer=function(){return this.decoder_.getBuffer()},jspb.BinaryReader.prototype.getFieldNumber=function(){return this.nextField_},jspb.BinaryReader.prototype.getWireType=function(){return this.nextWireType_},jspb.BinaryReader.prototype.isEndGroup=function(){return this.nextWireType_==jspb.BinaryConstants.WireType.END_GROUP},jspb.BinaryReader.prototype.getError=function(){return this.error_||this.decoder_.getError()},jspb.BinaryReader.prototype.setBlock=function(e,t,o){this.decoder_.setBlock(e,t,o),this.nextField_=jspb.BinaryConstants.INVALID_FIELD_NUMBER,this.nextWireType_=jspb.BinaryConstants.WireType.INVALID;},jspb.BinaryReader.prototype.reset=function(){this.decoder_.reset(),this.nextField_=jspb.BinaryConstants.INVALID_FIELD_NUMBER,this.nextWireType_=jspb.BinaryConstants.WireType.INVALID;},jspb.BinaryReader.prototype.advance=function(e){this.decoder_.advance(e);},jspb.BinaryReader.prototype.nextField=function(){if(this.decoder_.atEnd())return !1;if(this.getError())return goog.asserts.fail("Decoder hit an error"),!1;this.fieldCursor_=this.decoder_.getCursor();var e=this.decoder_.readUnsignedVarint32(),t=e>>>3;return (e&=7)!=jspb.BinaryConstants.WireType.VARINT&&e!=jspb.BinaryConstants.WireType.FIXED32&&e!=jspb.BinaryConstants.WireType.FIXED64&&e!=jspb.BinaryConstants.WireType.DELIMITED&&e!=jspb.BinaryConstants.WireType.START_GROUP&&e!=jspb.BinaryConstants.WireType.END_GROUP?(goog.asserts.fail("Invalid wire type: %s (at position %s)",e,this.fieldCursor_),this.error_=!0,!1):(this.nextField_=t,this.nextWireType_=e,!0)},jspb.BinaryReader.prototype.unskipHeader=function(){this.decoder_.unskipVarint(this.nextField_<<3|this.nextWireType_);},jspb.BinaryReader.prototype.skipMatchingFields=function(){var e=this.nextField_;for(this.unskipHeader();this.nextField()&&this.getFieldNumber()==e;)this.skipField();this.decoder_.atEnd()||this.unskipHeader();},jspb.BinaryReader.prototype.skipVarintField=function(){this.nextWireType_!=jspb.BinaryConstants.WireType.VARINT?(goog.asserts.fail("Invalid wire type for skipVarintField"),this.skipField()):this.decoder_.skipVarint();},jspb.BinaryReader.prototype.skipDelimitedField=function(){if(this.nextWireType_!=jspb.BinaryConstants.WireType.DELIMITED)goog.asserts.fail("Invalid wire type for skipDelimitedField"),this.skipField();else {var e=this.decoder_.readUnsignedVarint32();this.decoder_.advance(e);}},jspb.BinaryReader.prototype.skipFixed32Field=function(){this.nextWireType_!=jspb.BinaryConstants.WireType.FIXED32?(goog.asserts.fail("Invalid wire type for skipFixed32Field"),this.skipField()):this.decoder_.advance(4);},jspb.BinaryReader.prototype.skipFixed64Field=function(){this.nextWireType_!=jspb.BinaryConstants.WireType.FIXED64?(goog.asserts.fail("Invalid wire type for skipFixed64Field"),this.skipField()):this.decoder_.advance(8);},jspb.BinaryReader.prototype.skipGroup=function(){for(var e=this.nextField_;;){if(!this.nextField()){goog.asserts.fail("Unmatched start-group tag: stream EOF"),this.error_=!0;break}if(this.nextWireType_==jspb.BinaryConstants.WireType.END_GROUP){this.nextField_!=e&&(goog.asserts.fail("Unmatched end-group tag"),this.error_=!0);break}this.skipField();}},jspb.BinaryReader.prototype.skipField=function(){switch(this.nextWireType_){case jspb.BinaryConstants.WireType.VARINT:this.skipVarintField();break;case jspb.BinaryConstants.WireType.FIXED64:this.skipFixed64Field();break;case jspb.BinaryConstants.WireType.DELIMITED:this.skipDelimitedField();break;case jspb.BinaryConstants.WireType.FIXED32:this.skipFixed32Field();break;case jspb.BinaryConstants.WireType.START_GROUP:this.skipGroup();break;default:goog.asserts.fail("Invalid wire encoding for field.");}},jspb.BinaryReader.prototype.registerReadCallback=function(e,t){null===this.readCallbacks_&&(this.readCallbacks_={}),goog.asserts.assert(!this.readCallbacks_[e]),this.readCallbacks_[e]=t;},jspb.BinaryReader.prototype.runReadCallback=function(e){return goog.asserts.assert(null!==this.readCallbacks_),e=this.readCallbacks_[e],goog.asserts.assert(e),e(this)},jspb.BinaryReader.prototype.readAny=function(e){this.nextWireType_=jspb.BinaryConstants.FieldTypeToWireType(e);var t=jspb.BinaryConstants.FieldType;switch(e){case t.DOUBLE:return this.readDouble();case t.FLOAT:return this.readFloat();case t.INT64:return this.readInt64();case t.UINT64:return this.readUint64();case t.INT32:return this.readInt32();case t.FIXED64:return this.readFixed64();case t.FIXED32:return this.readFixed32();case t.BOOL:return this.readBool();case t.STRING:return this.readString();case t.GROUP:goog.asserts.fail("Group field type not supported in readAny()");case t.MESSAGE:goog.asserts.fail("Message field type not supported in readAny()");case t.BYTES:return this.readBytes();case t.UINT32:return this.readUint32();case t.ENUM:return this.readEnum();case t.SFIXED32:return this.readSfixed32();case t.SFIXED64:return this.readSfixed64();case t.SINT32:return this.readSint32();case t.SINT64:return this.readSint64();case t.FHASH64:return this.readFixedHash64();case t.VHASH64:return this.readVarintHash64();default:goog.asserts.fail("Invalid field type in readAny()");}return 0},jspb.BinaryReader.prototype.readMessage=function(e,t){goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.DELIMITED);var o=this.decoder_.getEnd(),r=this.decoder_.readUnsignedVarint32();r=this.decoder_.getCursor()+r,this.decoder_.setEnd(r),t(e,this),this.decoder_.setCursor(r),this.decoder_.setEnd(o);},jspb.BinaryReader.prototype.readGroup=function(e,t,o){goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.START_GROUP),goog.asserts.assert(this.nextField_==e),o(t,this),this.error_||this.nextWireType_==jspb.BinaryConstants.WireType.END_GROUP||(goog.asserts.fail("Group submessage did not end with an END_GROUP tag"),this.error_=!0);},jspb.BinaryReader.prototype.getFieldDecoder=function(){goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.DELIMITED);var e=this.decoder_.readUnsignedVarint32(),t=this.decoder_.getCursor(),o=t+e;return e=jspb.BinaryDecoder.alloc(this.decoder_.getBuffer(),t,e),this.decoder_.setCursor(o),e},jspb.BinaryReader.prototype.readInt32=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readSignedVarint32()},jspb.BinaryReader.prototype.readInt32String=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readSignedVarint32String()},jspb.BinaryReader.prototype.readInt64=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readSignedVarint64()},jspb.BinaryReader.prototype.readInt64String=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readSignedVarint64String()},jspb.BinaryReader.prototype.readUint32=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readUnsignedVarint32()},jspb.BinaryReader.prototype.readUint32String=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readUnsignedVarint32String()},jspb.BinaryReader.prototype.readUint64=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readUnsignedVarint64()},jspb.BinaryReader.prototype.readUint64String=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readUnsignedVarint64String()},jspb.BinaryReader.prototype.readSint32=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readZigzagVarint32()},jspb.BinaryReader.prototype.readSint64=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readZigzagVarint64()},jspb.BinaryReader.prototype.readSint64String=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readZigzagVarint64String()},jspb.BinaryReader.prototype.readFixed32=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.FIXED32),this.decoder_.readUint32()},jspb.BinaryReader.prototype.readFixed64=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.FIXED64),this.decoder_.readUint64()},jspb.BinaryReader.prototype.readFixed64String=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.FIXED64),this.decoder_.readUint64String()},jspb.BinaryReader.prototype.readSfixed32=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.FIXED32),this.decoder_.readInt32()},jspb.BinaryReader.prototype.readSfixed32String=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.FIXED32),this.decoder_.readInt32().toString()},jspb.BinaryReader.prototype.readSfixed64=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.FIXED64),this.decoder_.readInt64()},jspb.BinaryReader.prototype.readSfixed64String=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.FIXED64),this.decoder_.readInt64String()},jspb.BinaryReader.prototype.readFloat=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.FIXED32),this.decoder_.readFloat()},jspb.BinaryReader.prototype.readDouble=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.FIXED64),this.decoder_.readDouble()},jspb.BinaryReader.prototype.readBool=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),!!this.decoder_.readUnsignedVarint32()},jspb.BinaryReader.prototype.readEnum=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readSignedVarint64()},jspb.BinaryReader.prototype.readString=function(){goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.DELIMITED);var e=this.decoder_.readUnsignedVarint32();return this.decoder_.readString(e)},jspb.BinaryReader.prototype.readBytes=function(){goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.DELIMITED);var e=this.decoder_.readUnsignedVarint32();return this.decoder_.readBytes(e)},jspb.BinaryReader.prototype.readVarintHash64=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readVarintHash64()},jspb.BinaryReader.prototype.readSintHash64=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readZigzagVarintHash64()},jspb.BinaryReader.prototype.readSplitVarint64=function(e){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readSplitVarint64(e)},jspb.BinaryReader.prototype.readSplitZigzagVarint64=function(e){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.VARINT),this.decoder_.readSplitVarint64((function(t,o){return jspb.utils.fromZigzag64(t,o,e)}))},jspb.BinaryReader.prototype.readFixedHash64=function(){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.FIXED64),this.decoder_.readFixedHash64()},jspb.BinaryReader.prototype.readSplitFixed64=function(e){return goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.FIXED64),this.decoder_.readSplitFixed64(e)},jspb.BinaryReader.prototype.readPackedField_=function(e){goog.asserts.assert(this.nextWireType_==jspb.BinaryConstants.WireType.DELIMITED);var t=this.decoder_.readUnsignedVarint32();t=this.decoder_.getCursor()+t;for(var o=[];this.decoder_.getCursor()<t;)o.push(e.call(this.decoder_));return o},jspb.BinaryReader.prototype.readPackedInt32=function(){return this.readPackedField_(this.decoder_.readSignedVarint32)},jspb.BinaryReader.prototype.readPackedInt32String=function(){return this.readPackedField_(this.decoder_.readSignedVarint32String)},jspb.BinaryReader.prototype.readPackedInt64=function(){return this.readPackedField_(this.decoder_.readSignedVarint64)},jspb.BinaryReader.prototype.readPackedInt64String=function(){return this.readPackedField_(this.decoder_.readSignedVarint64String)},jspb.BinaryReader.prototype.readPackedUint32=function(){return this.readPackedField_(this.decoder_.readUnsignedVarint32)},jspb.BinaryReader.prototype.readPackedUint32String=function(){return this.readPackedField_(this.decoder_.readUnsignedVarint32String)},jspb.BinaryReader.prototype.readPackedUint64=function(){return this.readPackedField_(this.decoder_.readUnsignedVarint64)},jspb.BinaryReader.prototype.readPackedUint64String=function(){return this.readPackedField_(this.decoder_.readUnsignedVarint64String)},jspb.BinaryReader.prototype.readPackedSint32=function(){return this.readPackedField_(this.decoder_.readZigzagVarint32)},jspb.BinaryReader.prototype.readPackedSint64=function(){return this.readPackedField_(this.decoder_.readZigzagVarint64)},jspb.BinaryReader.prototype.readPackedSint64String=function(){return this.readPackedField_(this.decoder_.readZigzagVarint64String)},jspb.BinaryReader.prototype.readPackedFixed32=function(){return this.readPackedField_(this.decoder_.readUint32)},jspb.BinaryReader.prototype.readPackedFixed64=function(){return this.readPackedField_(this.decoder_.readUint64)},jspb.BinaryReader.prototype.readPackedFixed64String=function(){return this.readPackedField_(this.decoder_.readUint64String)},jspb.BinaryReader.prototype.readPackedSfixed32=function(){return this.readPackedField_(this.decoder_.readInt32)},jspb.BinaryReader.prototype.readPackedSfixed64=function(){return this.readPackedField_(this.decoder_.readInt64)},jspb.BinaryReader.prototype.readPackedSfixed64String=function(){return this.readPackedField_(this.decoder_.readInt64String)},jspb.BinaryReader.prototype.readPackedFloat=function(){return this.readPackedField_(this.decoder_.readFloat)},jspb.BinaryReader.prototype.readPackedDouble=function(){return this.readPackedField_(this.decoder_.readDouble)},jspb.BinaryReader.prototype.readPackedBool=function(){return this.readPackedField_(this.decoder_.readBool)},jspb.BinaryReader.prototype.readPackedEnum=function(){return this.readPackedField_(this.decoder_.readEnum)},jspb.BinaryReader.prototype.readPackedVarintHash64=function(){return this.readPackedField_(this.decoder_.readVarintHash64)},jspb.BinaryReader.prototype.readPackedFixedHash64=function(){return this.readPackedField_(this.decoder_.readFixedHash64)},jspb.Map=function(e,t){this.arr_=e,this.valueCtor_=t,this.map_={},this.arrClean=!0,0<this.arr_.length&&this.loadFromArray_();},jspb.Map.prototype.loadFromArray_=function(){for(var e=0;e<this.arr_.length;e++){var t=this.arr_[e],o=t[0];this.map_[o.toString()]=new jspb.Map.Entry_(o,t[1]);}this.arrClean=!0;},jspb.Map.prototype.toArray=function(){if(this.arrClean){if(this.valueCtor_){var e,t=this.map_;for(e in t)if(Object.prototype.hasOwnProperty.call(t,e)){var o=t[e].valueWrapper;o&&o.toArray();}}}else {for(this.arr_.length=0,(t=this.stringKeys_()).sort(),e=0;e<t.length;e++){var r=this.map_[t[e]];(o=r.valueWrapper)&&o.toArray(),this.arr_.push([r.key,r.value]);}this.arrClean=!0;}return this.arr_},jspb.Map.prototype.toObject=function(e,t){for(var o=this.toArray(),r=[],s=0;s<o.length;s++){var n=this.map_[o[s][0].toString()];this.wrapEntry_(n);var i=n.valueWrapper;i?(goog.asserts.assert(t),r.push([n.key,t(e,i)])):r.push([n.key,n.value]);}return r},jspb.Map.fromObject=function(e,t,o){t=new jspb.Map([],t);for(var r=0;r<e.length;r++){var s=e[r][0],n=o(e[r][1]);t.set(s,n);}return t},jspb.Map.ArrayIteratorIterable_=function(e){this.idx_=0,this.arr_=e;},jspb.Map.ArrayIteratorIterable_.prototype.next=function(){return this.idx_<this.arr_.length?{done:!1,value:this.arr_[this.idx_++]}:{done:!0,value:void 0}},"undefined"!=typeof Symbol&&(jspb.Map.ArrayIteratorIterable_.prototype[Symbol.iterator]=function(){return this}),jspb.Map.prototype.getLength=function(){return this.stringKeys_().length},jspb.Map.prototype.clear=function(){this.map_={},this.arrClean=!1;},jspb.Map.prototype.del=function(e){e=e.toString();var t=this.map_.hasOwnProperty(e);return delete this.map_[e],this.arrClean=!1,t},jspb.Map.prototype.getEntryList=function(){var e=[],t=this.stringKeys_();t.sort();for(var o=0;o<t.length;o++){var r=this.map_[t[o]];e.push([r.key,r.value]);}return e},jspb.Map.prototype.entries=function(){var e=[],t=this.stringKeys_();t.sort();for(var o=0;o<t.length;o++){var r=this.map_[t[o]];e.push([r.key,this.wrapEntry_(r)]);}return new jspb.Map.ArrayIteratorIterable_(e)},jspb.Map.prototype.keys=function(){var e=[],t=this.stringKeys_();t.sort();for(var o=0;o<t.length;o++)e.push(this.map_[t[o]].key);return new jspb.Map.ArrayIteratorIterable_(e)},jspb.Map.prototype.values=function(){var e=[],t=this.stringKeys_();t.sort();for(var o=0;o<t.length;o++)e.push(this.wrapEntry_(this.map_[t[o]]));return new jspb.Map.ArrayIteratorIterable_(e)},jspb.Map.prototype.forEach=function(e,t){var o=this.stringKeys_();o.sort();for(var r=0;r<o.length;r++){var s=this.map_[o[r]];e.call(t,this.wrapEntry_(s),s.key,this);}},jspb.Map.prototype.set=function(e,t){var o=new jspb.Map.Entry_(e);return this.valueCtor_?(o.valueWrapper=t,o.value=t.toArray()):o.value=t,this.map_[e.toString()]=o,this.arrClean=!1,this},jspb.Map.prototype.wrapEntry_=function(e){return this.valueCtor_?(e.valueWrapper||(e.valueWrapper=new this.valueCtor_(e.value)),e.valueWrapper):e.value},jspb.Map.prototype.get=function(e){if(e=this.map_[e.toString()])return this.wrapEntry_(e)},jspb.Map.prototype.has=function(e){return e.toString()in this.map_},jspb.Map.prototype.serializeBinary=function(e,t,o,r,s){var n=this.stringKeys_();n.sort();for(var i=0;i<n.length;i++){var a=this.map_[n[i]];t.beginSubMessage(e),o.call(t,1,a.key),this.valueCtor_?r.call(t,2,this.wrapEntry_(a),s):r.call(t,2,a.value),t.endSubMessage();}},jspb.Map.deserializeBinary=function(e,t,o,r,s,n,i){for(;t.nextField()&&!t.isEndGroup();){var a=t.getFieldNumber();1==a?n=o.call(t):2==a&&(e.valueCtor_?(goog.asserts.assert(s),i||(i=new e.valueCtor_),r.call(t,i,s)):i=r.call(t));}goog.asserts.assert(null!=n),goog.asserts.assert(null!=i),e.set(n,i);},jspb.Map.prototype.stringKeys_=function(){var e,t=this.map_,o=[];for(e in t)Object.prototype.hasOwnProperty.call(t,e)&&o.push(e);return o},jspb.Map.Entry_=function(e,t){this.key=e,this.value=t,this.valueWrapper=void 0;},jspb.ExtensionFieldInfo=function(e,t,o,r,s){this.fieldIndex=e,this.fieldName=t,this.ctor=o,this.toObjectFn=r,this.isRepeated=s;},jspb.ExtensionFieldBinaryInfo=function(e,t,o,r,s,n){this.fieldInfo=e,this.binaryReaderFn=t,this.binaryWriterFn=o,this.binaryMessageSerializeFn=r,this.binaryMessageDeserializeFn=s,this.isPacked=n;},jspb.ExtensionFieldInfo.prototype.isMessageType=function(){return !!this.ctor},jspb.Message=function(){},jspb.Message.GENERATE_TO_OBJECT=!0,jspb.Message.GENERATE_FROM_OBJECT=!goog.DISALLOW_TEST_ONLY_CODE,jspb.Message.GENERATE_TO_STRING=!0,jspb.Message.ASSUME_LOCAL_ARRAYS=!1,jspb.Message.SERIALIZE_EMPTY_TRAILING_FIELDS=!0,jspb.Message.SUPPORTS_UINT8ARRAY_="function"==typeof Uint8Array,jspb.Message.prototype.getJsPbMessageId=function(){return this.messageId_},jspb.Message.getIndex_=function(e,t){return t+e.arrayIndexOffset_},jspb.Message.hiddenES6Property_=function(){},jspb.Message.getFieldNumber_=function(e,t){return t-e.arrayIndexOffset_},jspb.Message.initialize=function(e,t,o,r,s,n){if(e.wrappers_=null,t||(t=o?[o]:[]),e.messageId_=o?String(o):void 0,e.arrayIndexOffset_=0===o?-1:0,e.array=t,jspb.Message.initPivotAndExtensionObject_(e,r),e.convertedPrimitiveFields_={},jspb.Message.SERIALIZE_EMPTY_TRAILING_FIELDS||(e.repeatedFields=s),s)for(t=0;t<s.length;t++)(o=s[t])<e.pivot_?(o=jspb.Message.getIndex_(e,o),e.array[o]=e.array[o]||jspb.Message.EMPTY_LIST_SENTINEL_):(jspb.Message.maybeInitEmptyExtensionObject_(e),e.extensionObject_[o]=e.extensionObject_[o]||jspb.Message.EMPTY_LIST_SENTINEL_);if(n&&n.length)for(t=0;t<n.length;t++)jspb.Message.computeOneofCase(e,n[t]);},jspb.Message.EMPTY_LIST_SENTINEL_=goog.DEBUG&&Object.freeze?Object.freeze([]):[],jspb.Message.isArray_=function(e){return jspb.Message.ASSUME_LOCAL_ARRAYS?e instanceof Array:goog.isArray(e)},jspb.Message.isExtensionObject_=function(e){return !(null===e||"object"!=typeof e||jspb.Message.isArray_(e)||jspb.Message.SUPPORTS_UINT8ARRAY_&&e instanceof Uint8Array)},jspb.Message.initPivotAndExtensionObject_=function(e,t){var o=e.array.length,r=-1;if(o&&(r=o-1,o=e.array[r],jspb.Message.isExtensionObject_(o)))return e.pivot_=jspb.Message.getFieldNumber_(e,r),void(e.extensionObject_=o);-1<t?(e.pivot_=Math.max(t,jspb.Message.getFieldNumber_(e,r+1)),e.extensionObject_=null):e.pivot_=Number.MAX_VALUE;},jspb.Message.maybeInitEmptyExtensionObject_=function(e){var t=jspb.Message.getIndex_(e,e.pivot_);e.array[t]||(e.extensionObject_=e.array[t]={});},jspb.Message.toObjectList=function(e,t,o){for(var r=[],s=0;s<e.length;s++)r[s]=t.call(e[s],o,e[s]);return r},jspb.Message.toObjectExtension=function(e,t,o,r,s){for(var n in o){var i=o[n],a=r.call(e,i);if(null!=a){for(var g in i.fieldName)if(i.fieldName.hasOwnProperty(g))break;t[g]=i.toObjectFn?i.isRepeated?jspb.Message.toObjectList(a,i.toObjectFn,s):i.toObjectFn(s,a):a;}}},jspb.Message.serializeBinaryExtensions=function(e,t,o,r){for(var s in o){var n=o[s],i=n.fieldInfo;if(!n.binaryWriterFn)throw Error("Message extension present that was generated without binary serialization support");var a=r.call(e,i);if(null!=a)if(i.isMessageType()){if(!n.binaryMessageSerializeFn)throw Error("Message extension present holding submessage without binary support enabled, and message is being serialized to binary format");n.binaryWriterFn.call(t,i.fieldIndex,a,n.binaryMessageSerializeFn);}else n.binaryWriterFn.call(t,i.fieldIndex,a);}},jspb.Message.readBinaryExtension=function(e,t,o,r,s){var n=o[t.getFieldNumber()];if(n){if(o=n.fieldInfo,!n.binaryReaderFn)throw Error("Deserializing extension whose generated code does not support binary format");if(o.isMessageType()){var i=new o.ctor;n.binaryReaderFn.call(t,i,n.binaryMessageDeserializeFn);}else i=n.binaryReaderFn.call(t);o.isRepeated&&!n.isPacked?(t=r.call(e,o))?t.push(i):s.call(e,o,[i]):s.call(e,o,i);}else t.skipField();},jspb.Message.getField=function(e,t){if(t<e.pivot_){t=jspb.Message.getIndex_(e,t);var o=e.array[t];return o===jspb.Message.EMPTY_LIST_SENTINEL_?e.array[t]=[]:o}if(e.extensionObject_)return (o=e.extensionObject_[t])===jspb.Message.EMPTY_LIST_SENTINEL_?e.extensionObject_[t]=[]:o},jspb.Message.getRepeatedField=function(e,t){return jspb.Message.getField(e,t)},jspb.Message.getOptionalFloatingPointField=function(e,t){return null==(e=jspb.Message.getField(e,t))?e:+e},jspb.Message.getBooleanField=function(e,t){return null==(e=jspb.Message.getField(e,t))?e:!!e},jspb.Message.getRepeatedFloatingPointField=function(e,t){var o=jspb.Message.getRepeatedField(e,t);if(e.convertedPrimitiveFields_||(e.convertedPrimitiveFields_={}),!e.convertedPrimitiveFields_[t]){for(var r=0;r<o.length;r++)o[r]=+o[r];e.convertedPrimitiveFields_[t]=!0;}return o},jspb.Message.getRepeatedBooleanField=function(e,t){var o=jspb.Message.getRepeatedField(e,t);if(e.convertedPrimitiveFields_||(e.convertedPrimitiveFields_={}),!e.convertedPrimitiveFields_[t]){for(var r=0;r<o.length;r++)o[r]=!!o[r];e.convertedPrimitiveFields_[t]=!0;}return o},jspb.Message.bytesAsB64=function(e){return null==e||"string"==typeof e?e:jspb.Message.SUPPORTS_UINT8ARRAY_&&e instanceof Uint8Array?goog.crypt.base64.encodeByteArray(e):(goog.asserts.fail("Cannot coerce to b64 string: "+goog.typeOf(e)),null)},jspb.Message.bytesAsU8=function(e){return null==e||e instanceof Uint8Array?e:"string"==typeof e?goog.crypt.base64.decodeStringToUint8Array(e):(goog.asserts.fail("Cannot coerce to Uint8Array: "+goog.typeOf(e)),null)},jspb.Message.bytesListAsB64=function(e){return jspb.Message.assertConsistentTypes_(e),e.length&&"string"!=typeof e[0]?goog.array.map(e,jspb.Message.bytesAsB64):e},jspb.Message.bytesListAsU8=function(e){return jspb.Message.assertConsistentTypes_(e),!e.length||e[0]instanceof Uint8Array?e:goog.array.map(e,jspb.Message.bytesAsU8)},jspb.Message.assertConsistentTypes_=function(e){if(goog.DEBUG&&e&&1<e.length){var t=goog.typeOf(e[0]);goog.array.forEach(e,(function(e){goog.typeOf(e)!=t&&goog.asserts.fail("Inconsistent type in JSPB repeated field array. Got "+goog.typeOf(e)+" expected "+t);}));}},jspb.Message.getFieldWithDefault=function(e,t,o){return null==(e=jspb.Message.getField(e,t))?o:e},jspb.Message.getBooleanFieldWithDefault=function(e,t,o){return null==(e=jspb.Message.getBooleanField(e,t))?o:e},jspb.Message.getFloatingPointFieldWithDefault=function(e,t,o){return null==(e=jspb.Message.getOptionalFloatingPointField(e,t))?o:e},jspb.Message.getFieldProto3=jspb.Message.getFieldWithDefault,jspb.Message.getMapField=function(e,t,o,r){if(e.wrappers_||(e.wrappers_={}),t in e.wrappers_)return e.wrappers_[t];var s=jspb.Message.getField(e,t);if(!s){if(o)return;s=[],jspb.Message.setField(e,t,s);}return e.wrappers_[t]=new jspb.Map(s,r)},jspb.Message.setField=function(e,t,o){return goog.asserts.assertInstanceof(e,jspb.Message),t<e.pivot_?e.array[jspb.Message.getIndex_(e,t)]=o:(jspb.Message.maybeInitEmptyExtensionObject_(e),e.extensionObject_[t]=o),e},jspb.Message.setProto3IntField=function(e,t,o){return jspb.Message.setFieldIgnoringDefault_(e,t,o,0)},jspb.Message.setProto3FloatField=function(e,t,o){return jspb.Message.setFieldIgnoringDefault_(e,t,o,0)},jspb.Message.setProto3BooleanField=function(e,t,o){return jspb.Message.setFieldIgnoringDefault_(e,t,o,!1)},jspb.Message.setProto3StringField=function(e,t,o){return jspb.Message.setFieldIgnoringDefault_(e,t,o,"")},jspb.Message.setProto3BytesField=function(e,t,o){return jspb.Message.setFieldIgnoringDefault_(e,t,o,"")},jspb.Message.setProto3EnumField=function(e,t,o){return jspb.Message.setFieldIgnoringDefault_(e,t,o,0)},jspb.Message.setProto3StringIntField=function(e,t,o){return jspb.Message.setFieldIgnoringDefault_(e,t,o,"0")},jspb.Message.setFieldIgnoringDefault_=function(e,t,o,r){return goog.asserts.assertInstanceof(e,jspb.Message),o!==r?jspb.Message.setField(e,t,o):e.array[jspb.Message.getIndex_(e,t)]=null,e},jspb.Message.addToRepeatedField=function(e,t,o,r){return goog.asserts.assertInstanceof(e,jspb.Message),t=jspb.Message.getRepeatedField(e,t),null!=r?t.splice(r,0,o):t.push(o),e},jspb.Message.setOneofField=function(e,t,o,r){return goog.asserts.assertInstanceof(e,jspb.Message),(o=jspb.Message.computeOneofCase(e,o))&&o!==t&&void 0!==r&&(e.wrappers_&&o in e.wrappers_&&(e.wrappers_[o]=void 0),jspb.Message.setField(e,o,void 0)),jspb.Message.setField(e,t,r)},jspb.Message.computeOneofCase=function(e,t){for(var o,r,s=0;s<t.length;s++){var n=t[s],i=jspb.Message.getField(e,n);null!=i&&(o=n,r=i,jspb.Message.setField(e,n,void 0));}return o?(jspb.Message.setField(e,o,r),o):0},jspb.Message.getWrapperField=function(e,t,o,r){if(e.wrappers_||(e.wrappers_={}),!e.wrappers_[o]){var s=jspb.Message.getField(e,o);(r||s)&&(e.wrappers_[o]=new t(s));}return e.wrappers_[o]},jspb.Message.getRepeatedWrapperField=function(e,t,o){return jspb.Message.wrapRepeatedField_(e,t,o),(t=e.wrappers_[o])==jspb.Message.EMPTY_LIST_SENTINEL_&&(t=e.wrappers_[o]=[]),t},jspb.Message.wrapRepeatedField_=function(e,t,o){if(e.wrappers_||(e.wrappers_={}),!e.wrappers_[o]){for(var r=jspb.Message.getRepeatedField(e,o),s=[],n=0;n<r.length;n++)s[n]=new t(r[n]);e.wrappers_[o]=s;}},jspb.Message.setWrapperField=function(e,t,o){goog.asserts.assertInstanceof(e,jspb.Message),e.wrappers_||(e.wrappers_={});var r=o?o.toArray():o;return e.wrappers_[t]=o,jspb.Message.setField(e,t,r)},jspb.Message.setOneofWrapperField=function(e,t,o,r){goog.asserts.assertInstanceof(e,jspb.Message),e.wrappers_||(e.wrappers_={});var s=r?r.toArray():r;return e.wrappers_[t]=r,jspb.Message.setOneofField(e,t,o,s)},jspb.Message.setRepeatedWrapperField=function(e,t,o){goog.asserts.assertInstanceof(e,jspb.Message),e.wrappers_||(e.wrappers_={}),o=o||[];for(var r=[],s=0;s<o.length;s++)r[s]=o[s].toArray();return e.wrappers_[t]=o,jspb.Message.setField(e,t,r)},jspb.Message.addToRepeatedWrapperField=function(e,t,o,r,s){jspb.Message.wrapRepeatedField_(e,r,t);var n=e.wrappers_[t];return n||(n=e.wrappers_[t]=[]),o=o||new r,e=jspb.Message.getRepeatedField(e,t),null!=s?(n.splice(s,0,o),e.splice(s,0,o.toArray())):(n.push(o),e.push(o.toArray())),o},jspb.Message.toMap=function(e,t,o,r){for(var s={},n=0;n<e.length;n++)s[t.call(e[n])]=o?o.call(e[n],r,e[n]):e[n];return s},jspb.Message.prototype.syncMapFields_=function(){if(this.wrappers_)for(var e in this.wrappers_){var t=this.wrappers_[e];if(goog.isArray(t))for(var o=0;o<t.length;o++)t[o]&&t[o].toArray();else t&&t.toArray();}},jspb.Message.prototype.toArray=function(){return this.syncMapFields_(),this.array},jspb.Message.GENERATE_TO_STRING&&(jspb.Message.prototype.toString=function(){return this.syncMapFields_(),this.array.toString()}),jspb.Message.prototype.getExtension=function(e){if(this.extensionObject_){this.wrappers_||(this.wrappers_={});var t=e.fieldIndex;if(e.isRepeated){if(e.isMessageType())return this.wrappers_[t]||(this.wrappers_[t]=goog.array.map(this.extensionObject_[t]||[],(function(t){return new e.ctor(t)}))),this.wrappers_[t]}else if(e.isMessageType())return !this.wrappers_[t]&&this.extensionObject_[t]&&(this.wrappers_[t]=new e.ctor(this.extensionObject_[t])),this.wrappers_[t];return this.extensionObject_[t]}},jspb.Message.prototype.setExtension=function(e,t){this.wrappers_||(this.wrappers_={}),jspb.Message.maybeInitEmptyExtensionObject_(this);var o=e.fieldIndex;return e.isRepeated?(t=t||[],e.isMessageType()?(this.wrappers_[o]=t,this.extensionObject_[o]=goog.array.map(t,(function(e){return e.toArray()}))):this.extensionObject_[o]=t):e.isMessageType()?(this.wrappers_[o]=t,this.extensionObject_[o]=t?t.toArray():t):this.extensionObject_[o]=t,this},jspb.Message.difference=function(e,t){if(!(e instanceof t.constructor))throw Error("Messages have different types.");var o=e.toArray();t=t.toArray();var r=[],s=0,n=o.length>t.length?o.length:t.length;for(e.getJsPbMessageId()&&(r[0]=e.getJsPbMessageId(),s=1);s<n;s++)jspb.Message.compareFields(o[s],t[s])||(r[s]=t[s]);return new e.constructor(r)},jspb.Message.equals=function(e,t){return e==t||!(!e||!t)&&e instanceof t.constructor&&jspb.Message.compareFields(e.toArray(),t.toArray())},jspb.Message.compareExtensions=function(e,t){e=e||{},t=t||{};var o,r={};for(o in e)r[o]=0;for(o in t)r[o]=0;for(o in r)if(!jspb.Message.compareFields(e[o],t[o]))return !1;return !0},jspb.Message.compareFields=function(e,t){if(e==t)return !0;if(!goog.isObject(e)||!goog.isObject(t))return !!("number"==typeof e&&isNaN(e)||"number"==typeof t&&isNaN(t))&&String(e)==String(t);if(e.constructor!=t.constructor)return !1;if(jspb.Message.SUPPORTS_UINT8ARRAY_&&e.constructor===Uint8Array){if(e.length!=t.length)return !1;for(var o=0;o<e.length;o++)if(e[o]!=t[o])return !1;return !0}if(e.constructor===Array){var r=void 0,s=void 0,n=Math.max(e.length,t.length);for(o=0;o<n;o++){var i=e[o],a=t[o];if(i&&i.constructor==Object&&(goog.asserts.assert(void 0===r),goog.asserts.assert(o===e.length-1),r=i,i=void 0),a&&a.constructor==Object&&(goog.asserts.assert(void 0===s),goog.asserts.assert(o===t.length-1),s=a,a=void 0),!jspb.Message.compareFields(i,a))return !1}return !r&&!s||(r=r||{},s=s||{},jspb.Message.compareExtensions(r,s))}if(e.constructor===Object)return jspb.Message.compareExtensions(e,t);throw Error("Invalid type in JSPB array")},jspb.Message.prototype.cloneMessage=function(){return jspb.Message.cloneMessage(this)},jspb.Message.prototype.clone=function(){return jspb.Message.cloneMessage(this)},jspb.Message.clone=function(e){return jspb.Message.cloneMessage(e)},jspb.Message.cloneMessage=function(e){return new e.constructor(jspb.Message.clone_(e.toArray()))},jspb.Message.copyInto=function(e,t){goog.asserts.assertInstanceof(e,jspb.Message),goog.asserts.assertInstanceof(t,jspb.Message),goog.asserts.assert(e.constructor==t.constructor,"Copy source and target message should have the same type."),e=jspb.Message.clone(e);for(var o=t.toArray(),r=e.toArray(),s=o.length=0;s<r.length;s++)o[s]=r[s];t.wrappers_=e.wrappers_,t.extensionObject_=e.extensionObject_;},jspb.Message.clone_=function(e){if(goog.isArray(e)){for(var t=Array(e.length),o=0;o<e.length;o++){var r=e[o];null!=r&&(t[o]="object"==typeof r?jspb.Message.clone_(goog.asserts.assert(r)):r);}return t}if(jspb.Message.SUPPORTS_UINT8ARRAY_&&e instanceof Uint8Array)return new Uint8Array(e);for(o in t={},e)null!=(r=e[o])&&(t[o]="object"==typeof r?jspb.Message.clone_(goog.asserts.assert(r)):r);return t},jspb.Message.registerMessageType=function(e,t){t.messageId=e;},jspb.Message.messageSetExtensions={},jspb.Message.messageSetExtensionsBinary={},jspb.arith={},jspb.arith.UInt64=function(e,t){this.lo=e,this.hi=t;},jspb.arith.UInt64.prototype.cmp=function(e){return this.hi<e.hi||this.hi==e.hi&&this.lo<e.lo?-1:this.hi==e.hi&&this.lo==e.lo?0:1},jspb.arith.UInt64.prototype.rightShift=function(){return new jspb.arith.UInt64((this.lo>>>1|(1&this.hi)<<31)>>>0,this.hi>>>1>>>0)},jspb.arith.UInt64.prototype.leftShift=function(){return new jspb.arith.UInt64(this.lo<<1>>>0,(this.hi<<1|this.lo>>>31)>>>0)},jspb.arith.UInt64.prototype.msb=function(){return !!(2147483648&this.hi)},jspb.arith.UInt64.prototype.lsb=function(){return !!(1&this.lo)},jspb.arith.UInt64.prototype.zero=function(){return 0==this.lo&&0==this.hi},jspb.arith.UInt64.prototype.add=function(e){return new jspb.arith.UInt64((this.lo+e.lo&4294967295)>>>0>>>0,((this.hi+e.hi&4294967295)>>>0)+(4294967296<=this.lo+e.lo?1:0)>>>0)},jspb.arith.UInt64.prototype.sub=function(e){return new jspb.arith.UInt64((this.lo-e.lo&4294967295)>>>0>>>0,((this.hi-e.hi&4294967295)>>>0)-(0>this.lo-e.lo?1:0)>>>0)},jspb.arith.UInt64.mul32x32=function(e,t){var o=65535&e,r=65535&t,s=t>>>16;for(t=o*r+65536*(o*s&65535)+65536*((e>>>=16)*r&65535),o=e*s+(o*s>>>16)+(e*r>>>16);4294967296<=t;)t-=4294967296,o+=1;return new jspb.arith.UInt64(t>>>0,o>>>0)},jspb.arith.UInt64.prototype.mul=function(e){var t=jspb.arith.UInt64.mul32x32(this.lo,e);return (e=jspb.arith.UInt64.mul32x32(this.hi,e)).hi=e.lo,e.lo=0,t.add(e)},jspb.arith.UInt64.prototype.div=function(e){if(0==e)return [];var t=new jspb.arith.UInt64(0,0),o=new jspb.arith.UInt64(this.lo,this.hi);e=new jspb.arith.UInt64(e,0);for(var r=new jspb.arith.UInt64(1,0);!e.msb();)e=e.leftShift(),r=r.leftShift();for(;!r.zero();)0>=e.cmp(o)&&(t=t.add(r),o=o.sub(e)),e=e.rightShift(),r=r.rightShift();return [t,o]},jspb.arith.UInt64.prototype.toString=function(){for(var e="",t=this;!t.zero();){var o=(t=t.div(10))[0];e=t[1].lo+e,t=o;}return ""==e&&(e="0"),e},jspb.arith.UInt64.fromString=function(e){for(var t=new jspb.arith.UInt64(0,0),o=new jspb.arith.UInt64(0,0),r=0;r<e.length;r++){if("0">e[r]||"9"<e[r])return null;var s=parseInt(e[r],10);o.lo=s,t=t.mul(10).add(o);}return t},jspb.arith.UInt64.prototype.clone=function(){return new jspb.arith.UInt64(this.lo,this.hi)},jspb.arith.Int64=function(e,t){this.lo=e,this.hi=t;},jspb.arith.Int64.prototype.add=function(e){return new jspb.arith.Int64((this.lo+e.lo&4294967295)>>>0>>>0,((this.hi+e.hi&4294967295)>>>0)+(4294967296<=this.lo+e.lo?1:0)>>>0)},jspb.arith.Int64.prototype.sub=function(e){return new jspb.arith.Int64((this.lo-e.lo&4294967295)>>>0>>>0,((this.hi-e.hi&4294967295)>>>0)-(0>this.lo-e.lo?1:0)>>>0)},jspb.arith.Int64.prototype.clone=function(){return new jspb.arith.Int64(this.lo,this.hi)},jspb.arith.Int64.prototype.toString=function(){var e=0!=(2147483648&this.hi),t=new jspb.arith.UInt64(this.lo,this.hi);return e&&(t=new jspb.arith.UInt64(0,0).sub(t)),(e?"-":"")+t.toString()},jspb.arith.Int64.fromString=function(e){var t=0<e.length&&"-"==e[0];return t&&(e=e.substring(1)),null===(e=jspb.arith.UInt64.fromString(e))?null:(t&&(e=new jspb.arith.UInt64(0,0).sub(e)),new jspb.arith.Int64(e.lo,e.hi))},jspb.BinaryEncoder=function(){this.buffer_=[];},jspb.BinaryEncoder.prototype.length=function(){return this.buffer_.length},jspb.BinaryEncoder.prototype.end=function(){var e=this.buffer_;return this.buffer_=[],e},jspb.BinaryEncoder.prototype.writeSplitVarint64=function(e,t){for(goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(t==Math.floor(t)),goog.asserts.assert(0<=e&&e<jspb.BinaryConstants.TWO_TO_32),goog.asserts.assert(0<=t&&t<jspb.BinaryConstants.TWO_TO_32);0<t||127<e;)this.buffer_.push(127&e|128),e=(e>>>7|t<<25)>>>0,t>>>=7;this.buffer_.push(e);},jspb.BinaryEncoder.prototype.writeSplitFixed64=function(e,t){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(t==Math.floor(t)),goog.asserts.assert(0<=e&&e<jspb.BinaryConstants.TWO_TO_32),goog.asserts.assert(0<=t&&t<jspb.BinaryConstants.TWO_TO_32),this.writeUint32(e),this.writeUint32(t);},jspb.BinaryEncoder.prototype.writeUnsignedVarint32=function(e){for(goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(0<=e&&e<jspb.BinaryConstants.TWO_TO_32);127<e;)this.buffer_.push(127&e|128),e>>>=7;this.buffer_.push(e);},jspb.BinaryEncoder.prototype.writeSignedVarint32=function(e){if(goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(e>=-jspb.BinaryConstants.TWO_TO_31&&e<jspb.BinaryConstants.TWO_TO_31),0<=e)this.writeUnsignedVarint32(e);else {for(var t=0;9>t;t++)this.buffer_.push(127&e|128),e>>=7;this.buffer_.push(1);}},jspb.BinaryEncoder.prototype.writeUnsignedVarint64=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(0<=e&&e<jspb.BinaryConstants.TWO_TO_64),jspb.utils.splitInt64(e),this.writeSplitVarint64(jspb.utils.split64Low,jspb.utils.split64High);},jspb.BinaryEncoder.prototype.writeSignedVarint64=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(e>=-jspb.BinaryConstants.TWO_TO_63&&e<jspb.BinaryConstants.TWO_TO_63),jspb.utils.splitInt64(e),this.writeSplitVarint64(jspb.utils.split64Low,jspb.utils.split64High);},jspb.BinaryEncoder.prototype.writeZigzagVarint32=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(e>=-jspb.BinaryConstants.TWO_TO_31&&e<jspb.BinaryConstants.TWO_TO_31),this.writeUnsignedVarint32((e<<1^e>>31)>>>0);},jspb.BinaryEncoder.prototype.writeZigzagVarint64=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(e>=-jspb.BinaryConstants.TWO_TO_63&&e<jspb.BinaryConstants.TWO_TO_63),jspb.utils.splitZigzag64(e),this.writeSplitVarint64(jspb.utils.split64Low,jspb.utils.split64High);},jspb.BinaryEncoder.prototype.writeZigzagVarint64String=function(e){this.writeZigzagVarintHash64(jspb.utils.decimalStringToHash64(e));},jspb.BinaryEncoder.prototype.writeZigzagVarintHash64=function(e){var t=this;jspb.utils.splitHash64(e),jspb.utils.toZigzag64(jspb.utils.split64Low,jspb.utils.split64High,(function(e,o){t.writeSplitVarint64(e>>>0,o>>>0);}));},jspb.BinaryEncoder.prototype.writeUint8=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(0<=e&&256>e),this.buffer_.push(e>>>0&255);},jspb.BinaryEncoder.prototype.writeUint16=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(0<=e&&65536>e),this.buffer_.push(e>>>0&255),this.buffer_.push(e>>>8&255);},jspb.BinaryEncoder.prototype.writeUint32=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(0<=e&&e<jspb.BinaryConstants.TWO_TO_32),this.buffer_.push(e>>>0&255),this.buffer_.push(e>>>8&255),this.buffer_.push(e>>>16&255),this.buffer_.push(e>>>24&255);},jspb.BinaryEncoder.prototype.writeUint64=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(0<=e&&e<jspb.BinaryConstants.TWO_TO_64),jspb.utils.splitUint64(e),this.writeUint32(jspb.utils.split64Low),this.writeUint32(jspb.utils.split64High);},jspb.BinaryEncoder.prototype.writeInt8=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(-128<=e&&128>e),this.buffer_.push(e>>>0&255);},jspb.BinaryEncoder.prototype.writeInt16=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(-32768<=e&&32768>e),this.buffer_.push(e>>>0&255),this.buffer_.push(e>>>8&255);},jspb.BinaryEncoder.prototype.writeInt32=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(e>=-jspb.BinaryConstants.TWO_TO_31&&e<jspb.BinaryConstants.TWO_TO_31),this.buffer_.push(e>>>0&255),this.buffer_.push(e>>>8&255),this.buffer_.push(e>>>16&255),this.buffer_.push(e>>>24&255);},jspb.BinaryEncoder.prototype.writeInt64=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(e>=-jspb.BinaryConstants.TWO_TO_63&&e<jspb.BinaryConstants.TWO_TO_63),jspb.utils.splitInt64(e),this.writeSplitFixed64(jspb.utils.split64Low,jspb.utils.split64High);},jspb.BinaryEncoder.prototype.writeInt64String=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(+e>=-jspb.BinaryConstants.TWO_TO_63&&+e<jspb.BinaryConstants.TWO_TO_63),jspb.utils.splitHash64(jspb.utils.decimalStringToHash64(e)),this.writeSplitFixed64(jspb.utils.split64Low,jspb.utils.split64High);},jspb.BinaryEncoder.prototype.writeFloat=function(e){goog.asserts.assert(1/0===e||-1/0===e||isNaN(e)||e>=-jspb.BinaryConstants.FLOAT32_MAX&&e<=jspb.BinaryConstants.FLOAT32_MAX),jspb.utils.splitFloat32(e),this.writeUint32(jspb.utils.split64Low);},jspb.BinaryEncoder.prototype.writeDouble=function(e){goog.asserts.assert(1/0===e||-1/0===e||isNaN(e)||e>=-jspb.BinaryConstants.FLOAT64_MAX&&e<=jspb.BinaryConstants.FLOAT64_MAX),jspb.utils.splitFloat64(e),this.writeUint32(jspb.utils.split64Low),this.writeUint32(jspb.utils.split64High);},jspb.BinaryEncoder.prototype.writeBool=function(e){goog.asserts.assert("boolean"==typeof e||"number"==typeof e),this.buffer_.push(e?1:0);},jspb.BinaryEncoder.prototype.writeEnum=function(e){goog.asserts.assert(e==Math.floor(e)),goog.asserts.assert(e>=-jspb.BinaryConstants.TWO_TO_31&&e<jspb.BinaryConstants.TWO_TO_31),this.writeSignedVarint32(e);},jspb.BinaryEncoder.prototype.writeBytes=function(e){this.buffer_.push.apply(this.buffer_,e);},jspb.BinaryEncoder.prototype.writeVarintHash64=function(e){jspb.utils.splitHash64(e),this.writeSplitVarint64(jspb.utils.split64Low,jspb.utils.split64High);},jspb.BinaryEncoder.prototype.writeFixedHash64=function(e){jspb.utils.splitHash64(e),this.writeUint32(jspb.utils.split64Low),this.writeUint32(jspb.utils.split64High);},jspb.BinaryEncoder.prototype.writeString=function(e){for(var t=this.buffer_.length,o=0;o<e.length;o++){var r=e.charCodeAt(o);if(128>r)this.buffer_.push(r);else if(2048>r)this.buffer_.push(r>>6|192),this.buffer_.push(63&r|128);else if(65536>r)if(55296<=r&&56319>=r&&o+1<e.length){var s=e.charCodeAt(o+1);56320<=s&&57343>=s&&(r=1024*(r-55296)+s-56320+65536,this.buffer_.push(r>>18|240),this.buffer_.push(r>>12&63|128),this.buffer_.push(r>>6&63|128),this.buffer_.push(63&r|128),o++);}else this.buffer_.push(r>>12|224),this.buffer_.push(r>>6&63|128),this.buffer_.push(63&r|128);}return this.buffer_.length-t},jspb.BinaryWriter=function(){this.blocks_=[],this.totalLength_=0,this.encoder_=new jspb.BinaryEncoder,this.bookmarks_=[];},jspb.BinaryWriter.prototype.appendUint8Array_=function(e){var t=this.encoder_.end();this.blocks_.push(t),this.blocks_.push(e),this.totalLength_+=t.length+e.length;},jspb.BinaryWriter.prototype.beginDelimited_=function(e){return this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.DELIMITED),e=this.encoder_.end(),this.blocks_.push(e),this.totalLength_+=e.length,e.push(this.totalLength_),e},jspb.BinaryWriter.prototype.endDelimited_=function(e){var t=e.pop();for(t=this.totalLength_+this.encoder_.length()-t,goog.asserts.assert(0<=t);127<t;)e.push(127&t|128),t>>>=7,this.totalLength_++;e.push(t),this.totalLength_++;},jspb.BinaryWriter.prototype.writeSerializedMessage=function(e,t,o){this.appendUint8Array_(e.subarray(t,o));},jspb.BinaryWriter.prototype.maybeWriteSerializedMessage=function(e,t,o){null!=e&&null!=t&&null!=o&&this.writeSerializedMessage(e,t,o);},jspb.BinaryWriter.prototype.reset=function(){this.blocks_=[],this.encoder_.end(),this.totalLength_=0,this.bookmarks_=[];},jspb.BinaryWriter.prototype.getResultBuffer=function(){goog.asserts.assert(0==this.bookmarks_.length);for(var e=new Uint8Array(this.totalLength_+this.encoder_.length()),t=this.blocks_,o=t.length,r=0,s=0;s<o;s++){var n=t[s];e.set(n,r),r+=n.length;}return t=this.encoder_.end(),e.set(t,r),r+=t.length,goog.asserts.assert(r==e.length),this.blocks_=[e],e},jspb.BinaryWriter.prototype.getResultBase64String=function(e){return goog.crypt.base64.encodeByteArray(this.getResultBuffer(),e)},jspb.BinaryWriter.prototype.beginSubMessage=function(e){this.bookmarks_.push(this.beginDelimited_(e));},jspb.BinaryWriter.prototype.endSubMessage=function(){goog.asserts.assert(0<=this.bookmarks_.length),this.endDelimited_(this.bookmarks_.pop());},jspb.BinaryWriter.prototype.writeFieldHeader_=function(e,t){goog.asserts.assert(1<=e&&e==Math.floor(e)),this.encoder_.writeUnsignedVarint32(8*e+t);},jspb.BinaryWriter.prototype.writeAny=function(e,t,o){var r=jspb.BinaryConstants.FieldType;switch(e){case r.DOUBLE:this.writeDouble(t,o);break;case r.FLOAT:this.writeFloat(t,o);break;case r.INT64:this.writeInt64(t,o);break;case r.UINT64:this.writeUint64(t,o);break;case r.INT32:this.writeInt32(t,o);break;case r.FIXED64:this.writeFixed64(t,o);break;case r.FIXED32:this.writeFixed32(t,o);break;case r.BOOL:this.writeBool(t,o);break;case r.STRING:this.writeString(t,o);break;case r.GROUP:goog.asserts.fail("Group field type not supported in writeAny()");break;case r.MESSAGE:goog.asserts.fail("Message field type not supported in writeAny()");break;case r.BYTES:this.writeBytes(t,o);break;case r.UINT32:this.writeUint32(t,o);break;case r.ENUM:this.writeEnum(t,o);break;case r.SFIXED32:this.writeSfixed32(t,o);break;case r.SFIXED64:this.writeSfixed64(t,o);break;case r.SINT32:this.writeSint32(t,o);break;case r.SINT64:this.writeSint64(t,o);break;case r.FHASH64:this.writeFixedHash64(t,o);break;case r.VHASH64:this.writeVarintHash64(t,o);break;default:goog.asserts.fail("Invalid field type in writeAny()");}},jspb.BinaryWriter.prototype.writeUnsignedVarint32_=function(e,t){null!=t&&(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeUnsignedVarint32(t));},jspb.BinaryWriter.prototype.writeSignedVarint32_=function(e,t){null!=t&&(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeSignedVarint32(t));},jspb.BinaryWriter.prototype.writeUnsignedVarint64_=function(e,t){null!=t&&(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeUnsignedVarint64(t));},jspb.BinaryWriter.prototype.writeSignedVarint64_=function(e,t){null!=t&&(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeSignedVarint64(t));},jspb.BinaryWriter.prototype.writeZigzagVarint32_=function(e,t){null!=t&&(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeZigzagVarint32(t));},jspb.BinaryWriter.prototype.writeZigzagVarint64_=function(e,t){null!=t&&(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeZigzagVarint64(t));},jspb.BinaryWriter.prototype.writeZigzagVarint64String_=function(e,t){null!=t&&(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeZigzagVarint64String(t));},jspb.BinaryWriter.prototype.writeZigzagVarintHash64_=function(e,t){null!=t&&(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeZigzagVarintHash64(t));},jspb.BinaryWriter.prototype.writeInt32=function(e,t){null!=t&&(goog.asserts.assert(t>=-jspb.BinaryConstants.TWO_TO_31&&t<jspb.BinaryConstants.TWO_TO_31),this.writeSignedVarint32_(e,t));},jspb.BinaryWriter.prototype.writeInt32String=function(e,t){null!=t&&(t=parseInt(t,10),goog.asserts.assert(t>=-jspb.BinaryConstants.TWO_TO_31&&t<jspb.BinaryConstants.TWO_TO_31),this.writeSignedVarint32_(e,t));},jspb.BinaryWriter.prototype.writeInt64=function(e,t){null!=t&&(goog.asserts.assert(t>=-jspb.BinaryConstants.TWO_TO_63&&t<jspb.BinaryConstants.TWO_TO_63),this.writeSignedVarint64_(e,t));},jspb.BinaryWriter.prototype.writeInt64String=function(e,t){null!=t&&(t=jspb.arith.Int64.fromString(t),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeSplitVarint64(t.lo,t.hi));},jspb.BinaryWriter.prototype.writeUint32=function(e,t){null!=t&&(goog.asserts.assert(0<=t&&t<jspb.BinaryConstants.TWO_TO_32),this.writeUnsignedVarint32_(e,t));},jspb.BinaryWriter.prototype.writeUint32String=function(e,t){null!=t&&(t=parseInt(t,10),goog.asserts.assert(0<=t&&t<jspb.BinaryConstants.TWO_TO_32),this.writeUnsignedVarint32_(e,t));},jspb.BinaryWriter.prototype.writeUint64=function(e,t){null!=t&&(goog.asserts.assert(0<=t&&t<jspb.BinaryConstants.TWO_TO_64),this.writeUnsignedVarint64_(e,t));},jspb.BinaryWriter.prototype.writeUint64String=function(e,t){null!=t&&(t=jspb.arith.UInt64.fromString(t),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeSplitVarint64(t.lo,t.hi));},jspb.BinaryWriter.prototype.writeSint32=function(e,t){null!=t&&(goog.asserts.assert(t>=-jspb.BinaryConstants.TWO_TO_31&&t<jspb.BinaryConstants.TWO_TO_31),this.writeZigzagVarint32_(e,t));},jspb.BinaryWriter.prototype.writeSint64=function(e,t){null!=t&&(goog.asserts.assert(t>=-jspb.BinaryConstants.TWO_TO_63&&t<jspb.BinaryConstants.TWO_TO_63),this.writeZigzagVarint64_(e,t));},jspb.BinaryWriter.prototype.writeSintHash64=function(e,t){null!=t&&this.writeZigzagVarintHash64_(e,t);},jspb.BinaryWriter.prototype.writeSint64String=function(e,t){null!=t&&this.writeZigzagVarint64String_(e,t);},jspb.BinaryWriter.prototype.writeFixed32=function(e,t){null!=t&&(goog.asserts.assert(0<=t&&t<jspb.BinaryConstants.TWO_TO_32),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.FIXED32),this.encoder_.writeUint32(t));},jspb.BinaryWriter.prototype.writeFixed64=function(e,t){null!=t&&(goog.asserts.assert(0<=t&&t<jspb.BinaryConstants.TWO_TO_64),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.FIXED64),this.encoder_.writeUint64(t));},jspb.BinaryWriter.prototype.writeFixed64String=function(e,t){null!=t&&(t=jspb.arith.UInt64.fromString(t),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.FIXED64),this.encoder_.writeSplitFixed64(t.lo,t.hi));},jspb.BinaryWriter.prototype.writeSfixed32=function(e,t){null!=t&&(goog.asserts.assert(t>=-jspb.BinaryConstants.TWO_TO_31&&t<jspb.BinaryConstants.TWO_TO_31),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.FIXED32),this.encoder_.writeInt32(t));},jspb.BinaryWriter.prototype.writeSfixed64=function(e,t){null!=t&&(goog.asserts.assert(t>=-jspb.BinaryConstants.TWO_TO_63&&t<jspb.BinaryConstants.TWO_TO_63),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.FIXED64),this.encoder_.writeInt64(t));},jspb.BinaryWriter.prototype.writeSfixed64String=function(e,t){null!=t&&(t=jspb.arith.Int64.fromString(t),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.FIXED64),this.encoder_.writeSplitFixed64(t.lo,t.hi));},jspb.BinaryWriter.prototype.writeFloat=function(e,t){null!=t&&(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.FIXED32),this.encoder_.writeFloat(t));},jspb.BinaryWriter.prototype.writeDouble=function(e,t){null!=t&&(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.FIXED64),this.encoder_.writeDouble(t));},jspb.BinaryWriter.prototype.writeBool=function(e,t){null!=t&&(goog.asserts.assert("boolean"==typeof t||"number"==typeof t),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeBool(t));},jspb.BinaryWriter.prototype.writeEnum=function(e,t){null!=t&&(goog.asserts.assert(t>=-jspb.BinaryConstants.TWO_TO_31&&t<jspb.BinaryConstants.TWO_TO_31),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeSignedVarint32(t));},jspb.BinaryWriter.prototype.writeString=function(e,t){null!=t&&(e=this.beginDelimited_(e),this.encoder_.writeString(t),this.endDelimited_(e));},jspb.BinaryWriter.prototype.writeBytes=function(e,t){null!=t&&(t=jspb.utils.byteSourceToUint8Array(t),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.DELIMITED),this.encoder_.writeUnsignedVarint32(t.length),this.appendUint8Array_(t));},jspb.BinaryWriter.prototype.writeMessage=function(e,t,o){null!=t&&(e=this.beginDelimited_(e),o(t,this),this.endDelimited_(e));},jspb.BinaryWriter.prototype.writeMessageSet=function(e,t,o){null!=t&&(this.writeFieldHeader_(1,jspb.BinaryConstants.WireType.START_GROUP),this.writeFieldHeader_(2,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeSignedVarint32(e),e=this.beginDelimited_(3),o(t,this),this.endDelimited_(e),this.writeFieldHeader_(1,jspb.BinaryConstants.WireType.END_GROUP));},jspb.BinaryWriter.prototype.writeGroup=function(e,t,o){null!=t&&(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.START_GROUP),o(t,this),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.END_GROUP));},jspb.BinaryWriter.prototype.writeFixedHash64=function(e,t){null!=t&&(goog.asserts.assert(8==t.length),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.FIXED64),this.encoder_.writeFixedHash64(t));},jspb.BinaryWriter.prototype.writeVarintHash64=function(e,t){null!=t&&(goog.asserts.assert(8==t.length),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeVarintHash64(t));},jspb.BinaryWriter.prototype.writeSplitFixed64=function(e,t,o){this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.FIXED64),this.encoder_.writeSplitFixed64(t,o);},jspb.BinaryWriter.prototype.writeSplitVarint64=function(e,t,o){this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT),this.encoder_.writeSplitVarint64(t,o);},jspb.BinaryWriter.prototype.writeSplitZigzagVarint64=function(e,t,o){this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.VARINT);var r=this.encoder_;jspb.utils.toZigzag64(t,o,(function(e,t){r.writeSplitVarint64(e>>>0,t>>>0);}));},jspb.BinaryWriter.prototype.writeRepeatedInt32=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeSignedVarint32_(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedInt32String=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeInt32String(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedInt64=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeSignedVarint64_(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedSplitFixed64=function(e,t,o,r){if(null!=t)for(var s=0;s<t.length;s++)this.writeSplitFixed64(e,o(t[s]),r(t[s]));},jspb.BinaryWriter.prototype.writeRepeatedSplitVarint64=function(e,t,o,r){if(null!=t)for(var s=0;s<t.length;s++)this.writeSplitVarint64(e,o(t[s]),r(t[s]));},jspb.BinaryWriter.prototype.writeRepeatedSplitZigzagVarint64=function(e,t,o,r){if(null!=t)for(var s=0;s<t.length;s++)this.writeSplitZigzagVarint64(e,o(t[s]),r(t[s]));},jspb.BinaryWriter.prototype.writeRepeatedInt64String=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeInt64String(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedUint32=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeUnsignedVarint32_(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedUint32String=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeUint32String(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedUint64=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeUnsignedVarint64_(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedUint64String=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeUint64String(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedSint32=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeZigzagVarint32_(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedSint64=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeZigzagVarint64_(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedSint64String=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeZigzagVarint64String_(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedSintHash64=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeZigzagVarintHash64_(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedFixed32=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeFixed32(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedFixed64=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeFixed64(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedFixed64String=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeFixed64String(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedSfixed32=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeSfixed32(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedSfixed64=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeSfixed64(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedSfixed64String=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeSfixed64String(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedFloat=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeFloat(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedDouble=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeDouble(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedBool=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeBool(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedEnum=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeEnum(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedString=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeString(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedBytes=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeBytes(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedMessage=function(e,t,o){if(null!=t)for(var r=0;r<t.length;r++){var s=this.beginDelimited_(e);o(t[r],this),this.endDelimited_(s);}},jspb.BinaryWriter.prototype.writeRepeatedGroup=function(e,t,o){if(null!=t)for(var r=0;r<t.length;r++)this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.START_GROUP),o(t[r],this),this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.END_GROUP);},jspb.BinaryWriter.prototype.writeRepeatedFixedHash64=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeFixedHash64(e,t[o]);},jspb.BinaryWriter.prototype.writeRepeatedVarintHash64=function(e,t){if(null!=t)for(var o=0;o<t.length;o++)this.writeVarintHash64(e,t[o]);},jspb.BinaryWriter.prototype.writePackedInt32=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++)this.encoder_.writeSignedVarint32(t[o]);this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedInt32String=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++)this.encoder_.writeSignedVarint32(parseInt(t[o],10));this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedInt64=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++)this.encoder_.writeSignedVarint64(t[o]);this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedSplitFixed64=function(e,t,o,r){if(null!=t){e=this.beginDelimited_(e);for(var s=0;s<t.length;s++)this.encoder_.writeSplitFixed64(o(t[s]),r(t[s]));this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedSplitVarint64=function(e,t,o,r){if(null!=t){e=this.beginDelimited_(e);for(var s=0;s<t.length;s++)this.encoder_.writeSplitVarint64(o(t[s]),r(t[s]));this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedSplitZigzagVarint64=function(e,t,o,r){if(null!=t){e=this.beginDelimited_(e);for(var s=this.encoder_,n=0;n<t.length;n++)jspb.utils.toZigzag64(o(t[n]),r(t[n]),(function(e,t){s.writeSplitVarint64(e>>>0,t>>>0);}));this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedInt64String=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++){var r=jspb.arith.Int64.fromString(t[o]);this.encoder_.writeSplitVarint64(r.lo,r.hi);}this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedUint32=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++)this.encoder_.writeUnsignedVarint32(t[o]);this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedUint32String=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++)this.encoder_.writeUnsignedVarint32(parseInt(t[o],10));this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedUint64=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++)this.encoder_.writeUnsignedVarint64(t[o]);this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedUint64String=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++){var r=jspb.arith.UInt64.fromString(t[o]);this.encoder_.writeSplitVarint64(r.lo,r.hi);}this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedSint32=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++)this.encoder_.writeZigzagVarint32(t[o]);this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedSint64=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++)this.encoder_.writeZigzagVarint64(t[o]);this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedSint64String=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++)this.encoder_.writeZigzagVarintHash64(jspb.utils.decimalStringToHash64(t[o]));this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedSintHash64=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++)this.encoder_.writeZigzagVarintHash64(t[o]);this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedFixed32=function(e,t){if(null!=t&&t.length)for(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.DELIMITED),this.encoder_.writeUnsignedVarint32(4*t.length),e=0;e<t.length;e++)this.encoder_.writeUint32(t[e]);},jspb.BinaryWriter.prototype.writePackedFixed64=function(e,t){if(null!=t&&t.length)for(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.DELIMITED),this.encoder_.writeUnsignedVarint32(8*t.length),e=0;e<t.length;e++)this.encoder_.writeUint64(t[e]);},jspb.BinaryWriter.prototype.writePackedFixed64String=function(e,t){if(null!=t&&t.length)for(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.DELIMITED),this.encoder_.writeUnsignedVarint32(8*t.length),e=0;e<t.length;e++){var o=jspb.arith.UInt64.fromString(t[e]);this.encoder_.writeSplitFixed64(o.lo,o.hi);}},jspb.BinaryWriter.prototype.writePackedSfixed32=function(e,t){if(null!=t&&t.length)for(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.DELIMITED),this.encoder_.writeUnsignedVarint32(4*t.length),e=0;e<t.length;e++)this.encoder_.writeInt32(t[e]);},jspb.BinaryWriter.prototype.writePackedSfixed64=function(e,t){if(null!=t&&t.length)for(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.DELIMITED),this.encoder_.writeUnsignedVarint32(8*t.length),e=0;e<t.length;e++)this.encoder_.writeInt64(t[e]);},jspb.BinaryWriter.prototype.writePackedSfixed64String=function(e,t){if(null!=t&&t.length)for(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.DELIMITED),this.encoder_.writeUnsignedVarint32(8*t.length),e=0;e<t.length;e++)this.encoder_.writeInt64String(t[e]);},jspb.BinaryWriter.prototype.writePackedFloat=function(e,t){if(null!=t&&t.length)for(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.DELIMITED),this.encoder_.writeUnsignedVarint32(4*t.length),e=0;e<t.length;e++)this.encoder_.writeFloat(t[e]);},jspb.BinaryWriter.prototype.writePackedDouble=function(e,t){if(null!=t&&t.length)for(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.DELIMITED),this.encoder_.writeUnsignedVarint32(8*t.length),e=0;e<t.length;e++)this.encoder_.writeDouble(t[e]);},jspb.BinaryWriter.prototype.writePackedBool=function(e,t){if(null!=t&&t.length)for(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.DELIMITED),this.encoder_.writeUnsignedVarint32(t.length),e=0;e<t.length;e++)this.encoder_.writeBool(t[e]);},jspb.BinaryWriter.prototype.writePackedEnum=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++)this.encoder_.writeEnum(t[o]);this.endDelimited_(e);}},jspb.BinaryWriter.prototype.writePackedFixedHash64=function(e,t){if(null!=t&&t.length)for(this.writeFieldHeader_(e,jspb.BinaryConstants.WireType.DELIMITED),this.encoder_.writeUnsignedVarint32(8*t.length),e=0;e<t.length;e++)this.encoder_.writeFixedHash64(t[e]);},jspb.BinaryWriter.prototype.writePackedVarintHash64=function(e,t){if(null!=t&&t.length){e=this.beginDelimited_(e);for(var o=0;o<t.length;o++)this.encoder_.writeVarintHash64(t[o]);this.endDelimited_(e);}},jspb.Export={},exports.Map=jspb.Map,exports.Message=jspb.Message,exports.BinaryReader=jspb.BinaryReader,exports.BinaryWriter=jspb.BinaryWriter,exports.ExtensionFieldInfo=jspb.ExtensionFieldInfo,exports.ExtensionFieldBinaryInfo=jspb.ExtensionFieldBinaryInfo,exports.exportSymbol=goog.exportSymbol,exports.inherits=goog.inherits,exports.object={extend:goog.object.extend},exports.typeOf=goog.typeOf;},function(e,t,o){var r=o(0),s=r,n=Function("return this")();s.exportSymbol("proto.flow.entities.Account",null,n),s.exportSymbol("proto.flow.entities.AccountKey",null,n),proto.flow.entities.Account=function(e){r.Message.initialize(this,e,0,-1,proto.flow.entities.Account.repeatedFields_,null);},s.inherits(proto.flow.entities.Account,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.entities.Account.displayName="proto.flow.entities.Account"),proto.flow.entities.AccountKey=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.entities.AccountKey,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.entities.AccountKey.displayName="proto.flow.entities.AccountKey"),proto.flow.entities.Account.repeatedFields_=[4],r.Message.GENERATE_TO_OBJECT&&(proto.flow.entities.Account.prototype.toObject=function(e){return proto.flow.entities.Account.toObject(e,this)},proto.flow.entities.Account.toObject=function(e,t){var o,s={address:t.getAddress_asB64(),balance:r.Message.getFieldWithDefault(t,2,0),code:t.getCode_asB64(),keysList:r.Message.toObjectList(t.getKeysList(),proto.flow.entities.AccountKey.toObject,e),contractsMap:(o=t.getContractsMap())?o.toObject(e,void 0):[]};return e&&(s.$jspbMessageInstance=t),s}),proto.flow.entities.Account.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.entities.Account;return proto.flow.entities.Account.deserializeBinaryFromReader(o,t)},proto.flow.entities.Account.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setAddress(o);break;case 2:o=t.readUint64();e.setBalance(o);break;case 3:o=t.readBytes();e.setCode(o);break;case 4:o=new proto.flow.entities.AccountKey;t.readMessage(o,proto.flow.entities.AccountKey.deserializeBinaryFromReader),e.addKeys(o);break;case 5:o=e.getContractsMap();t.readMessage(o,(function(e,t){r.Map.deserializeBinary(e,t,r.BinaryReader.prototype.readString,r.BinaryReader.prototype.readBytes,null,"","");}));break;default:t.skipField();}}return e},proto.flow.entities.Account.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.entities.Account.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.entities.Account.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getAddress_asU8()).length>0&&t.writeBytes(1,o),0!==(o=e.getBalance())&&t.writeUint64(2,o),(o=e.getCode_asU8()).length>0&&t.writeBytes(3,o),(o=e.getKeysList()).length>0&&t.writeRepeatedMessage(4,o,proto.flow.entities.AccountKey.serializeBinaryToWriter),(o=e.getContractsMap(!0))&&o.getLength()>0&&o.serializeBinary(5,t,r.BinaryWriter.prototype.writeString,r.BinaryWriter.prototype.writeBytes);},proto.flow.entities.Account.prototype.getAddress=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.entities.Account.prototype.getAddress_asB64=function(){return r.Message.bytesAsB64(this.getAddress())},proto.flow.entities.Account.prototype.getAddress_asU8=function(){return r.Message.bytesAsU8(this.getAddress())},proto.flow.entities.Account.prototype.setAddress=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.entities.Account.prototype.getBalance=function(){return r.Message.getFieldWithDefault(this,2,0)},proto.flow.entities.Account.prototype.setBalance=function(e){return r.Message.setProto3IntField(this,2,e)},proto.flow.entities.Account.prototype.getCode=function(){return r.Message.getFieldWithDefault(this,3,"")},proto.flow.entities.Account.prototype.getCode_asB64=function(){return r.Message.bytesAsB64(this.getCode())},proto.flow.entities.Account.prototype.getCode_asU8=function(){return r.Message.bytesAsU8(this.getCode())},proto.flow.entities.Account.prototype.setCode=function(e){return r.Message.setProto3BytesField(this,3,e)},proto.flow.entities.Account.prototype.getKeysList=function(){return r.Message.getRepeatedWrapperField(this,proto.flow.entities.AccountKey,4)},proto.flow.entities.Account.prototype.setKeysList=function(e){return r.Message.setRepeatedWrapperField(this,4,e)},proto.flow.entities.Account.prototype.addKeys=function(e,t){return r.Message.addToRepeatedWrapperField(this,4,e,proto.flow.entities.AccountKey,t)},proto.flow.entities.Account.prototype.clearKeysList=function(){return this.setKeysList([])},proto.flow.entities.Account.prototype.getContractsMap=function(e){return r.Message.getMapField(this,5,e,null)},proto.flow.entities.Account.prototype.clearContractsMap=function(){return this.getContractsMap().clear(),this},r.Message.GENERATE_TO_OBJECT&&(proto.flow.entities.AccountKey.prototype.toObject=function(e){return proto.flow.entities.AccountKey.toObject(e,this)},proto.flow.entities.AccountKey.toObject=function(e,t){var o={index:r.Message.getFieldWithDefault(t,1,0),publicKey:t.getPublicKey_asB64(),signAlgo:r.Message.getFieldWithDefault(t,3,0),hashAlgo:r.Message.getFieldWithDefault(t,4,0),weight:r.Message.getFieldWithDefault(t,5,0),sequenceNumber:r.Message.getFieldWithDefault(t,6,0),revoked:r.Message.getBooleanFieldWithDefault(t,7,!1)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.entities.AccountKey.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.entities.AccountKey;return proto.flow.entities.AccountKey.deserializeBinaryFromReader(o,t)},proto.flow.entities.AccountKey.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readUint32();e.setIndex(o);break;case 2:o=t.readBytes();e.setPublicKey(o);break;case 3:o=t.readUint32();e.setSignAlgo(o);break;case 4:o=t.readUint32();e.setHashAlgo(o);break;case 5:o=t.readUint32();e.setWeight(o);break;case 6:o=t.readUint32();e.setSequenceNumber(o);break;case 7:o=t.readBool();e.setRevoked(o);break;default:t.skipField();}}return e},proto.flow.entities.AccountKey.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.entities.AccountKey.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.entities.AccountKey.serializeBinaryToWriter=function(e,t){var o=void 0;0!==(o=e.getIndex())&&t.writeUint32(1,o),(o=e.getPublicKey_asU8()).length>0&&t.writeBytes(2,o),0!==(o=e.getSignAlgo())&&t.writeUint32(3,o),0!==(o=e.getHashAlgo())&&t.writeUint32(4,o),0!==(o=e.getWeight())&&t.writeUint32(5,o),0!==(o=e.getSequenceNumber())&&t.writeUint32(6,o),(o=e.getRevoked())&&t.writeBool(7,o);},proto.flow.entities.AccountKey.prototype.getIndex=function(){return r.Message.getFieldWithDefault(this,1,0)},proto.flow.entities.AccountKey.prototype.setIndex=function(e){return r.Message.setProto3IntField(this,1,e)},proto.flow.entities.AccountKey.prototype.getPublicKey=function(){return r.Message.getFieldWithDefault(this,2,"")},proto.flow.entities.AccountKey.prototype.getPublicKey_asB64=function(){return r.Message.bytesAsB64(this.getPublicKey())},proto.flow.entities.AccountKey.prototype.getPublicKey_asU8=function(){return r.Message.bytesAsU8(this.getPublicKey())},proto.flow.entities.AccountKey.prototype.setPublicKey=function(e){return r.Message.setProto3BytesField(this,2,e)},proto.flow.entities.AccountKey.prototype.getSignAlgo=function(){return r.Message.getFieldWithDefault(this,3,0)},proto.flow.entities.AccountKey.prototype.setSignAlgo=function(e){return r.Message.setProto3IntField(this,3,e)},proto.flow.entities.AccountKey.prototype.getHashAlgo=function(){return r.Message.getFieldWithDefault(this,4,0)},proto.flow.entities.AccountKey.prototype.setHashAlgo=function(e){return r.Message.setProto3IntField(this,4,e)},proto.flow.entities.AccountKey.prototype.getWeight=function(){return r.Message.getFieldWithDefault(this,5,0)},proto.flow.entities.AccountKey.prototype.setWeight=function(e){return r.Message.setProto3IntField(this,5,e)},proto.flow.entities.AccountKey.prototype.getSequenceNumber=function(){return r.Message.getFieldWithDefault(this,6,0)},proto.flow.entities.AccountKey.prototype.setSequenceNumber=function(e){return r.Message.setProto3IntField(this,6,e)},proto.flow.entities.AccountKey.prototype.getRevoked=function(){return r.Message.getBooleanFieldWithDefault(this,7,!1)},proto.flow.entities.AccountKey.prototype.setRevoked=function(e){return r.Message.setProto3BooleanField(this,7,e)},s.object.extend(t,proto.flow.entities);},function(e,t,o){var r=o(0),s=r,n=Function("return this")();s.exportSymbol("proto.flow.entities.Collection",null,n),s.exportSymbol("proto.flow.entities.CollectionGuarantee",null,n),proto.flow.entities.Collection=function(e){r.Message.initialize(this,e,0,-1,proto.flow.entities.Collection.repeatedFields_,null);},s.inherits(proto.flow.entities.Collection,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.entities.Collection.displayName="proto.flow.entities.Collection"),proto.flow.entities.CollectionGuarantee=function(e){r.Message.initialize(this,e,0,-1,proto.flow.entities.CollectionGuarantee.repeatedFields_,null);},s.inherits(proto.flow.entities.CollectionGuarantee,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.entities.CollectionGuarantee.displayName="proto.flow.entities.CollectionGuarantee"),proto.flow.entities.Collection.repeatedFields_=[2],r.Message.GENERATE_TO_OBJECT&&(proto.flow.entities.Collection.prototype.toObject=function(e){return proto.flow.entities.Collection.toObject(e,this)},proto.flow.entities.Collection.toObject=function(e,t){var o={id:t.getId_asB64(),transactionIdsList:t.getTransactionIdsList_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.entities.Collection.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.entities.Collection;return proto.flow.entities.Collection.deserializeBinaryFromReader(o,t)},proto.flow.entities.Collection.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setId(o);break;case 2:o=t.readBytes();e.addTransactionIds(o);break;default:t.skipField();}}return e},proto.flow.entities.Collection.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.entities.Collection.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.entities.Collection.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getId_asU8()).length>0&&t.writeBytes(1,o),(o=e.getTransactionIdsList_asU8()).length>0&&t.writeRepeatedBytes(2,o);},proto.flow.entities.Collection.prototype.getId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.entities.Collection.prototype.getId_asB64=function(){return r.Message.bytesAsB64(this.getId())},proto.flow.entities.Collection.prototype.getId_asU8=function(){return r.Message.bytesAsU8(this.getId())},proto.flow.entities.Collection.prototype.setId=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.entities.Collection.prototype.getTransactionIdsList=function(){return r.Message.getRepeatedField(this,2)},proto.flow.entities.Collection.prototype.getTransactionIdsList_asB64=function(){return r.Message.bytesListAsB64(this.getTransactionIdsList())},proto.flow.entities.Collection.prototype.getTransactionIdsList_asU8=function(){return r.Message.bytesListAsU8(this.getTransactionIdsList())},proto.flow.entities.Collection.prototype.setTransactionIdsList=function(e){return r.Message.setField(this,2,e||[])},proto.flow.entities.Collection.prototype.addTransactionIds=function(e,t){return r.Message.addToRepeatedField(this,2,e,t)},proto.flow.entities.Collection.prototype.clearTransactionIdsList=function(){return this.setTransactionIdsList([])},proto.flow.entities.CollectionGuarantee.repeatedFields_=[2],r.Message.GENERATE_TO_OBJECT&&(proto.flow.entities.CollectionGuarantee.prototype.toObject=function(e){return proto.flow.entities.CollectionGuarantee.toObject(e,this)},proto.flow.entities.CollectionGuarantee.toObject=function(e,t){var o={collectionId:t.getCollectionId_asB64(),signaturesList:t.getSignaturesList_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.entities.CollectionGuarantee.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.entities.CollectionGuarantee;return proto.flow.entities.CollectionGuarantee.deserializeBinaryFromReader(o,t)},proto.flow.entities.CollectionGuarantee.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setCollectionId(o);break;case 2:o=t.readBytes();e.addSignatures(o);break;default:t.skipField();}}return e},proto.flow.entities.CollectionGuarantee.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.entities.CollectionGuarantee.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.entities.CollectionGuarantee.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getCollectionId_asU8()).length>0&&t.writeBytes(1,o),(o=e.getSignaturesList_asU8()).length>0&&t.writeRepeatedBytes(2,o);},proto.flow.entities.CollectionGuarantee.prototype.getCollectionId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.entities.CollectionGuarantee.prototype.getCollectionId_asB64=function(){return r.Message.bytesAsB64(this.getCollectionId())},proto.flow.entities.CollectionGuarantee.prototype.getCollectionId_asU8=function(){return r.Message.bytesAsU8(this.getCollectionId())},proto.flow.entities.CollectionGuarantee.prototype.setCollectionId=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.entities.CollectionGuarantee.prototype.getSignaturesList=function(){return r.Message.getRepeatedField(this,2)},proto.flow.entities.CollectionGuarantee.prototype.getSignaturesList_asB64=function(){return r.Message.bytesListAsB64(this.getSignaturesList())},proto.flow.entities.CollectionGuarantee.prototype.getSignaturesList_asU8=function(){return r.Message.bytesListAsU8(this.getSignaturesList())},proto.flow.entities.CollectionGuarantee.prototype.setSignaturesList=function(e){return r.Message.setField(this,2,e||[])},proto.flow.entities.CollectionGuarantee.prototype.addSignatures=function(e,t){return r.Message.addToRepeatedField(this,2,e,t)},proto.flow.entities.CollectionGuarantee.prototype.clearSignaturesList=function(){return this.setSignaturesList([])},s.object.extend(t,proto.flow.entities);},function(e,t,o){var r=o(0),s=r,n=Function("return this")();s.exportSymbol("proto.flow.entities.Event",null,n),proto.flow.entities.Event=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.entities.Event,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.entities.Event.displayName="proto.flow.entities.Event"),r.Message.GENERATE_TO_OBJECT&&(proto.flow.entities.Event.prototype.toObject=function(e){return proto.flow.entities.Event.toObject(e,this)},proto.flow.entities.Event.toObject=function(e,t){var o={type:r.Message.getFieldWithDefault(t,1,""),transactionId:t.getTransactionId_asB64(),transactionIndex:r.Message.getFieldWithDefault(t,3,0),eventIndex:r.Message.getFieldWithDefault(t,4,0),payload:t.getPayload_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.entities.Event.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.entities.Event;return proto.flow.entities.Event.deserializeBinaryFromReader(o,t)},proto.flow.entities.Event.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readString();e.setType(o);break;case 2:o=t.readBytes();e.setTransactionId(o);break;case 3:o=t.readUint32();e.setTransactionIndex(o);break;case 4:o=t.readUint32();e.setEventIndex(o);break;case 5:o=t.readBytes();e.setPayload(o);break;default:t.skipField();}}return e},proto.flow.entities.Event.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.entities.Event.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.entities.Event.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getType()).length>0&&t.writeString(1,o),(o=e.getTransactionId_asU8()).length>0&&t.writeBytes(2,o),0!==(o=e.getTransactionIndex())&&t.writeUint32(3,o),0!==(o=e.getEventIndex())&&t.writeUint32(4,o),(o=e.getPayload_asU8()).length>0&&t.writeBytes(5,o);},proto.flow.entities.Event.prototype.getType=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.entities.Event.prototype.setType=function(e){return r.Message.setProto3StringField(this,1,e)},proto.flow.entities.Event.prototype.getTransactionId=function(){return r.Message.getFieldWithDefault(this,2,"")},proto.flow.entities.Event.prototype.getTransactionId_asB64=function(){return r.Message.bytesAsB64(this.getTransactionId())},proto.flow.entities.Event.prototype.getTransactionId_asU8=function(){return r.Message.bytesAsU8(this.getTransactionId())},proto.flow.entities.Event.prototype.setTransactionId=function(e){return r.Message.setProto3BytesField(this,2,e)},proto.flow.entities.Event.prototype.getTransactionIndex=function(){return r.Message.getFieldWithDefault(this,3,0)},proto.flow.entities.Event.prototype.setTransactionIndex=function(e){return r.Message.setProto3IntField(this,3,e)},proto.flow.entities.Event.prototype.getEventIndex=function(){return r.Message.getFieldWithDefault(this,4,0)},proto.flow.entities.Event.prototype.setEventIndex=function(e){return r.Message.setProto3IntField(this,4,e)},proto.flow.entities.Event.prototype.getPayload=function(){return r.Message.getFieldWithDefault(this,5,"")},proto.flow.entities.Event.prototype.getPayload_asB64=function(){return r.Message.bytesAsB64(this.getPayload())},proto.flow.entities.Event.prototype.getPayload_asU8=function(){return r.Message.bytesAsU8(this.getPayload())},proto.flow.entities.Event.prototype.setPayload=function(e){return r.Message.setProto3BytesField(this,5,e)},s.object.extend(t,proto.flow.entities);},function(e,t,o){var r=o(0),s=r,n=Function("return this")(),i=o(1);s.object.extend(proto,i);var a=o(5);s.object.extend(proto,a);var g=o(7);s.object.extend(proto,g);var l=o(2);s.object.extend(proto,l);var c=o(3);s.object.extend(proto,c);var u=o(9);s.object.extend(proto,u);var p=o(6);s.object.extend(proto,p),s.exportSymbol("proto.flow.access.AccountResponse",null,n),s.exportSymbol("proto.flow.access.BlockHeaderResponse",null,n),s.exportSymbol("proto.flow.access.BlockResponse",null,n),s.exportSymbol("proto.flow.access.CollectionResponse",null,n),s.exportSymbol("proto.flow.access.EventsResponse",null,n),s.exportSymbol("proto.flow.access.EventsResponse.Result",null,n),s.exportSymbol("proto.flow.access.ExecuteScriptAtBlockHeightRequest",null,n),s.exportSymbol("proto.flow.access.ExecuteScriptAtBlockIDRequest",null,n),s.exportSymbol("proto.flow.access.ExecuteScriptAtLatestBlockRequest",null,n),s.exportSymbol("proto.flow.access.ExecuteScriptResponse",null,n),s.exportSymbol("proto.flow.access.GetAccountAtBlockHeightRequest",null,n),s.exportSymbol("proto.flow.access.GetAccountAtLatestBlockRequest",null,n),s.exportSymbol("proto.flow.access.GetAccountRequest",null,n),s.exportSymbol("proto.flow.access.GetAccountResponse",null,n),s.exportSymbol("proto.flow.access.GetBlockByHeightRequest",null,n),s.exportSymbol("proto.flow.access.GetBlockByIDRequest",null,n),s.exportSymbol("proto.flow.access.GetBlockHeaderByHeightRequest",null,n),s.exportSymbol("proto.flow.access.GetBlockHeaderByIDRequest",null,n),s.exportSymbol("proto.flow.access.GetCollectionByIDRequest",null,n),s.exportSymbol("proto.flow.access.GetEventsForBlockIDsRequest",null,n),s.exportSymbol("proto.flow.access.GetEventsForHeightRangeRequest",null,n),s.exportSymbol("proto.flow.access.GetLatestBlockHeaderRequest",null,n),s.exportSymbol("proto.flow.access.GetLatestBlockRequest",null,n),s.exportSymbol("proto.flow.access.GetNetworkParametersRequest",null,n),s.exportSymbol("proto.flow.access.GetNetworkParametersResponse",null,n),s.exportSymbol("proto.flow.access.GetTransactionRequest",null,n),s.exportSymbol("proto.flow.access.PingRequest",null,n),s.exportSymbol("proto.flow.access.PingResponse",null,n),s.exportSymbol("proto.flow.access.SendTransactionRequest",null,n),s.exportSymbol("proto.flow.access.SendTransactionResponse",null,n),s.exportSymbol("proto.flow.access.TransactionResponse",null,n),s.exportSymbol("proto.flow.access.TransactionResultResponse",null,n),proto.flow.access.PingRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.PingRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.PingRequest.displayName="proto.flow.access.PingRequest"),proto.flow.access.PingResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.PingResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.PingResponse.displayName="proto.flow.access.PingResponse"),proto.flow.access.GetLatestBlockHeaderRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetLatestBlockHeaderRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetLatestBlockHeaderRequest.displayName="proto.flow.access.GetLatestBlockHeaderRequest"),proto.flow.access.GetBlockHeaderByIDRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetBlockHeaderByIDRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetBlockHeaderByIDRequest.displayName="proto.flow.access.GetBlockHeaderByIDRequest"),proto.flow.access.GetBlockHeaderByHeightRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetBlockHeaderByHeightRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetBlockHeaderByHeightRequest.displayName="proto.flow.access.GetBlockHeaderByHeightRequest"),proto.flow.access.BlockHeaderResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.BlockHeaderResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.BlockHeaderResponse.displayName="proto.flow.access.BlockHeaderResponse"),proto.flow.access.GetLatestBlockRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetLatestBlockRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetLatestBlockRequest.displayName="proto.flow.access.GetLatestBlockRequest"),proto.flow.access.GetBlockByIDRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetBlockByIDRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetBlockByIDRequest.displayName="proto.flow.access.GetBlockByIDRequest"),proto.flow.access.GetBlockByHeightRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetBlockByHeightRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetBlockByHeightRequest.displayName="proto.flow.access.GetBlockByHeightRequest"),proto.flow.access.BlockResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.BlockResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.BlockResponse.displayName="proto.flow.access.BlockResponse"),proto.flow.access.GetCollectionByIDRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetCollectionByIDRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetCollectionByIDRequest.displayName="proto.flow.access.GetCollectionByIDRequest"),proto.flow.access.CollectionResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.CollectionResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.CollectionResponse.displayName="proto.flow.access.CollectionResponse"),proto.flow.access.SendTransactionRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.SendTransactionRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.SendTransactionRequest.displayName="proto.flow.access.SendTransactionRequest"),proto.flow.access.SendTransactionResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.SendTransactionResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.SendTransactionResponse.displayName="proto.flow.access.SendTransactionResponse"),proto.flow.access.GetTransactionRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetTransactionRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetTransactionRequest.displayName="proto.flow.access.GetTransactionRequest"),proto.flow.access.TransactionResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.TransactionResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.TransactionResponse.displayName="proto.flow.access.TransactionResponse"),proto.flow.access.TransactionResultResponse=function(e){r.Message.initialize(this,e,0,-1,proto.flow.access.TransactionResultResponse.repeatedFields_,null);},s.inherits(proto.flow.access.TransactionResultResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.TransactionResultResponse.displayName="proto.flow.access.TransactionResultResponse"),proto.flow.access.GetAccountRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetAccountRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetAccountRequest.displayName="proto.flow.access.GetAccountRequest"),proto.flow.access.GetAccountResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetAccountResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetAccountResponse.displayName="proto.flow.access.GetAccountResponse"),proto.flow.access.GetAccountAtLatestBlockRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetAccountAtLatestBlockRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetAccountAtLatestBlockRequest.displayName="proto.flow.access.GetAccountAtLatestBlockRequest"),proto.flow.access.AccountResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.AccountResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.AccountResponse.displayName="proto.flow.access.AccountResponse"),proto.flow.access.GetAccountAtBlockHeightRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetAccountAtBlockHeightRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetAccountAtBlockHeightRequest.displayName="proto.flow.access.GetAccountAtBlockHeightRequest"),proto.flow.access.ExecuteScriptAtLatestBlockRequest=function(e){r.Message.initialize(this,e,0,-1,proto.flow.access.ExecuteScriptAtLatestBlockRequest.repeatedFields_,null);},s.inherits(proto.flow.access.ExecuteScriptAtLatestBlockRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.ExecuteScriptAtLatestBlockRequest.displayName="proto.flow.access.ExecuteScriptAtLatestBlockRequest"),proto.flow.access.ExecuteScriptAtBlockIDRequest=function(e){r.Message.initialize(this,e,0,-1,proto.flow.access.ExecuteScriptAtBlockIDRequest.repeatedFields_,null);},s.inherits(proto.flow.access.ExecuteScriptAtBlockIDRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.ExecuteScriptAtBlockIDRequest.displayName="proto.flow.access.ExecuteScriptAtBlockIDRequest"),proto.flow.access.ExecuteScriptAtBlockHeightRequest=function(e){r.Message.initialize(this,e,0,-1,proto.flow.access.ExecuteScriptAtBlockHeightRequest.repeatedFields_,null);},s.inherits(proto.flow.access.ExecuteScriptAtBlockHeightRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.ExecuteScriptAtBlockHeightRequest.displayName="proto.flow.access.ExecuteScriptAtBlockHeightRequest"),proto.flow.access.ExecuteScriptResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.ExecuteScriptResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.ExecuteScriptResponse.displayName="proto.flow.access.ExecuteScriptResponse"),proto.flow.access.GetEventsForHeightRangeRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetEventsForHeightRangeRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetEventsForHeightRangeRequest.displayName="proto.flow.access.GetEventsForHeightRangeRequest"),proto.flow.access.GetEventsForBlockIDsRequest=function(e){r.Message.initialize(this,e,0,-1,proto.flow.access.GetEventsForBlockIDsRequest.repeatedFields_,null);},s.inherits(proto.flow.access.GetEventsForBlockIDsRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetEventsForBlockIDsRequest.displayName="proto.flow.access.GetEventsForBlockIDsRequest"),proto.flow.access.EventsResponse=function(e){r.Message.initialize(this,e,0,-1,proto.flow.access.EventsResponse.repeatedFields_,null);},s.inherits(proto.flow.access.EventsResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.EventsResponse.displayName="proto.flow.access.EventsResponse"),proto.flow.access.EventsResponse.Result=function(e){r.Message.initialize(this,e,0,-1,proto.flow.access.EventsResponse.Result.repeatedFields_,null);},s.inherits(proto.flow.access.EventsResponse.Result,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.EventsResponse.Result.displayName="proto.flow.access.EventsResponse.Result"),proto.flow.access.GetNetworkParametersRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetNetworkParametersRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetNetworkParametersRequest.displayName="proto.flow.access.GetNetworkParametersRequest"),proto.flow.access.GetNetworkParametersResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.access.GetNetworkParametersResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.access.GetNetworkParametersResponse.displayName="proto.flow.access.GetNetworkParametersResponse"),r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.PingRequest.prototype.toObject=function(e){return proto.flow.access.PingRequest.toObject(e,this)},proto.flow.access.PingRequest.toObject=function(e,t){var o={};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.PingRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.PingRequest;return proto.flow.access.PingRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.PingRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){t.getFieldNumber();t.skipField();}return e},proto.flow.access.PingRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.PingRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.PingRequest.serializeBinaryToWriter=function(e,t){},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.PingResponse.prototype.toObject=function(e){return proto.flow.access.PingResponse.toObject(e,this)},proto.flow.access.PingResponse.toObject=function(e,t){var o={};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.PingResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.PingResponse;return proto.flow.access.PingResponse.deserializeBinaryFromReader(o,t)},proto.flow.access.PingResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){t.getFieldNumber();t.skipField();}return e},proto.flow.access.PingResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.PingResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.PingResponse.serializeBinaryToWriter=function(e,t){},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetLatestBlockHeaderRequest.prototype.toObject=function(e){return proto.flow.access.GetLatestBlockHeaderRequest.toObject(e,this)},proto.flow.access.GetLatestBlockHeaderRequest.toObject=function(e,t){var o={isSealed:r.Message.getBooleanFieldWithDefault(t,1,!1)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetLatestBlockHeaderRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetLatestBlockHeaderRequest;return proto.flow.access.GetLatestBlockHeaderRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetLatestBlockHeaderRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBool();e.setIsSealed(o);break;default:t.skipField();}}return e},proto.flow.access.GetLatestBlockHeaderRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetLatestBlockHeaderRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetLatestBlockHeaderRequest.serializeBinaryToWriter=function(e,t){var o;(o=e.getIsSealed())&&t.writeBool(1,o);},proto.flow.access.GetLatestBlockHeaderRequest.prototype.getIsSealed=function(){return r.Message.getBooleanFieldWithDefault(this,1,!1)},proto.flow.access.GetLatestBlockHeaderRequest.prototype.setIsSealed=function(e){return r.Message.setProto3BooleanField(this,1,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetBlockHeaderByIDRequest.prototype.toObject=function(e){return proto.flow.access.GetBlockHeaderByIDRequest.toObject(e,this)},proto.flow.access.GetBlockHeaderByIDRequest.toObject=function(e,t){var o={id:t.getId_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetBlockHeaderByIDRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetBlockHeaderByIDRequest;return proto.flow.access.GetBlockHeaderByIDRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetBlockHeaderByIDRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setId(o);break;default:t.skipField();}}return e},proto.flow.access.GetBlockHeaderByIDRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetBlockHeaderByIDRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetBlockHeaderByIDRequest.serializeBinaryToWriter=function(e,t){var o;(o=e.getId_asU8()).length>0&&t.writeBytes(1,o);},proto.flow.access.GetBlockHeaderByIDRequest.prototype.getId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.GetBlockHeaderByIDRequest.prototype.getId_asB64=function(){return r.Message.bytesAsB64(this.getId())},proto.flow.access.GetBlockHeaderByIDRequest.prototype.getId_asU8=function(){return r.Message.bytesAsU8(this.getId())},proto.flow.access.GetBlockHeaderByIDRequest.prototype.setId=function(e){return r.Message.setProto3BytesField(this,1,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetBlockHeaderByHeightRequest.prototype.toObject=function(e){return proto.flow.access.GetBlockHeaderByHeightRequest.toObject(e,this)},proto.flow.access.GetBlockHeaderByHeightRequest.toObject=function(e,t){var o={height:r.Message.getFieldWithDefault(t,1,0)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetBlockHeaderByHeightRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetBlockHeaderByHeightRequest;return proto.flow.access.GetBlockHeaderByHeightRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetBlockHeaderByHeightRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readUint64();e.setHeight(o);break;default:t.skipField();}}return e},proto.flow.access.GetBlockHeaderByHeightRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetBlockHeaderByHeightRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetBlockHeaderByHeightRequest.serializeBinaryToWriter=function(e,t){var o;0!==(o=e.getHeight())&&t.writeUint64(1,o);},proto.flow.access.GetBlockHeaderByHeightRequest.prototype.getHeight=function(){return r.Message.getFieldWithDefault(this,1,0)},proto.flow.access.GetBlockHeaderByHeightRequest.prototype.setHeight=function(e){return r.Message.setProto3IntField(this,1,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.BlockHeaderResponse.prototype.toObject=function(e){return proto.flow.access.BlockHeaderResponse.toObject(e,this)},proto.flow.access.BlockHeaderResponse.toObject=function(e,t){var o,r={block:(o=t.getBlock())&&a.BlockHeader.toObject(e,o)};return e&&(r.$jspbMessageInstance=t),r}),proto.flow.access.BlockHeaderResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.BlockHeaderResponse;return proto.flow.access.BlockHeaderResponse.deserializeBinaryFromReader(o,t)},proto.flow.access.BlockHeaderResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=new a.BlockHeader;t.readMessage(o,a.BlockHeader.deserializeBinaryFromReader),e.setBlock(o);break;default:t.skipField();}}return e},proto.flow.access.BlockHeaderResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.BlockHeaderResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.BlockHeaderResponse.serializeBinaryToWriter=function(e,t){var o;null!=(o=e.getBlock())&&t.writeMessage(1,o,a.BlockHeader.serializeBinaryToWriter);},proto.flow.access.BlockHeaderResponse.prototype.getBlock=function(){return r.Message.getWrapperField(this,a.BlockHeader,1)},proto.flow.access.BlockHeaderResponse.prototype.setBlock=function(e){return r.Message.setWrapperField(this,1,e)},proto.flow.access.BlockHeaderResponse.prototype.clearBlock=function(){return this.setBlock(void 0)},proto.flow.access.BlockHeaderResponse.prototype.hasBlock=function(){return null!=r.Message.getField(this,1)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetLatestBlockRequest.prototype.toObject=function(e){return proto.flow.access.GetLatestBlockRequest.toObject(e,this)},proto.flow.access.GetLatestBlockRequest.toObject=function(e,t){var o={isSealed:r.Message.getBooleanFieldWithDefault(t,1,!1)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetLatestBlockRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetLatestBlockRequest;return proto.flow.access.GetLatestBlockRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetLatestBlockRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBool();e.setIsSealed(o);break;default:t.skipField();}}return e},proto.flow.access.GetLatestBlockRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetLatestBlockRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetLatestBlockRequest.serializeBinaryToWriter=function(e,t){var o;(o=e.getIsSealed())&&t.writeBool(1,o);},proto.flow.access.GetLatestBlockRequest.prototype.getIsSealed=function(){return r.Message.getBooleanFieldWithDefault(this,1,!1)},proto.flow.access.GetLatestBlockRequest.prototype.setIsSealed=function(e){return r.Message.setProto3BooleanField(this,1,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetBlockByIDRequest.prototype.toObject=function(e){return proto.flow.access.GetBlockByIDRequest.toObject(e,this)},proto.flow.access.GetBlockByIDRequest.toObject=function(e,t){var o={id:t.getId_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetBlockByIDRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetBlockByIDRequest;return proto.flow.access.GetBlockByIDRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetBlockByIDRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setId(o);break;default:t.skipField();}}return e},proto.flow.access.GetBlockByIDRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetBlockByIDRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetBlockByIDRequest.serializeBinaryToWriter=function(e,t){var o;(o=e.getId_asU8()).length>0&&t.writeBytes(1,o);},proto.flow.access.GetBlockByIDRequest.prototype.getId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.GetBlockByIDRequest.prototype.getId_asB64=function(){return r.Message.bytesAsB64(this.getId())},proto.flow.access.GetBlockByIDRequest.prototype.getId_asU8=function(){return r.Message.bytesAsU8(this.getId())},proto.flow.access.GetBlockByIDRequest.prototype.setId=function(e){return r.Message.setProto3BytesField(this,1,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetBlockByHeightRequest.prototype.toObject=function(e){return proto.flow.access.GetBlockByHeightRequest.toObject(e,this)},proto.flow.access.GetBlockByHeightRequest.toObject=function(e,t){var o={height:r.Message.getFieldWithDefault(t,1,0)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetBlockByHeightRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetBlockByHeightRequest;return proto.flow.access.GetBlockByHeightRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetBlockByHeightRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readUint64();e.setHeight(o);break;default:t.skipField();}}return e},proto.flow.access.GetBlockByHeightRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetBlockByHeightRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetBlockByHeightRequest.serializeBinaryToWriter=function(e,t){var o;0!==(o=e.getHeight())&&t.writeUint64(1,o);},proto.flow.access.GetBlockByHeightRequest.prototype.getHeight=function(){return r.Message.getFieldWithDefault(this,1,0)},proto.flow.access.GetBlockByHeightRequest.prototype.setHeight=function(e){return r.Message.setProto3IntField(this,1,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.BlockResponse.prototype.toObject=function(e){return proto.flow.access.BlockResponse.toObject(e,this)},proto.flow.access.BlockResponse.toObject=function(e,t){var o,r={block:(o=t.getBlock())&&g.Block.toObject(e,o)};return e&&(r.$jspbMessageInstance=t),r}),proto.flow.access.BlockResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.BlockResponse;return proto.flow.access.BlockResponse.deserializeBinaryFromReader(o,t)},proto.flow.access.BlockResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=new g.Block;t.readMessage(o,g.Block.deserializeBinaryFromReader),e.setBlock(o);break;default:t.skipField();}}return e},proto.flow.access.BlockResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.BlockResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.BlockResponse.serializeBinaryToWriter=function(e,t){var o;null!=(o=e.getBlock())&&t.writeMessage(1,o,g.Block.serializeBinaryToWriter);},proto.flow.access.BlockResponse.prototype.getBlock=function(){return r.Message.getWrapperField(this,g.Block,1)},proto.flow.access.BlockResponse.prototype.setBlock=function(e){return r.Message.setWrapperField(this,1,e)},proto.flow.access.BlockResponse.prototype.clearBlock=function(){return this.setBlock(void 0)},proto.flow.access.BlockResponse.prototype.hasBlock=function(){return null!=r.Message.getField(this,1)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetCollectionByIDRequest.prototype.toObject=function(e){return proto.flow.access.GetCollectionByIDRequest.toObject(e,this)},proto.flow.access.GetCollectionByIDRequest.toObject=function(e,t){var o={id:t.getId_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetCollectionByIDRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetCollectionByIDRequest;return proto.flow.access.GetCollectionByIDRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetCollectionByIDRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setId(o);break;default:t.skipField();}}return e},proto.flow.access.GetCollectionByIDRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetCollectionByIDRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetCollectionByIDRequest.serializeBinaryToWriter=function(e,t){var o;(o=e.getId_asU8()).length>0&&t.writeBytes(1,o);},proto.flow.access.GetCollectionByIDRequest.prototype.getId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.GetCollectionByIDRequest.prototype.getId_asB64=function(){return r.Message.bytesAsB64(this.getId())},proto.flow.access.GetCollectionByIDRequest.prototype.getId_asU8=function(){return r.Message.bytesAsU8(this.getId())},proto.flow.access.GetCollectionByIDRequest.prototype.setId=function(e){return r.Message.setProto3BytesField(this,1,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.CollectionResponse.prototype.toObject=function(e){return proto.flow.access.CollectionResponse.toObject(e,this)},proto.flow.access.CollectionResponse.toObject=function(e,t){var o,r={collection:(o=t.getCollection())&&l.Collection.toObject(e,o)};return e&&(r.$jspbMessageInstance=t),r}),proto.flow.access.CollectionResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.CollectionResponse;return proto.flow.access.CollectionResponse.deserializeBinaryFromReader(o,t)},proto.flow.access.CollectionResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=new l.Collection;t.readMessage(o,l.Collection.deserializeBinaryFromReader),e.setCollection(o);break;default:t.skipField();}}return e},proto.flow.access.CollectionResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.CollectionResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.CollectionResponse.serializeBinaryToWriter=function(e,t){var o;null!=(o=e.getCollection())&&t.writeMessage(1,o,l.Collection.serializeBinaryToWriter);},proto.flow.access.CollectionResponse.prototype.getCollection=function(){return r.Message.getWrapperField(this,l.Collection,1)},proto.flow.access.CollectionResponse.prototype.setCollection=function(e){return r.Message.setWrapperField(this,1,e)},proto.flow.access.CollectionResponse.prototype.clearCollection=function(){return this.setCollection(void 0)},proto.flow.access.CollectionResponse.prototype.hasCollection=function(){return null!=r.Message.getField(this,1)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.SendTransactionRequest.prototype.toObject=function(e){return proto.flow.access.SendTransactionRequest.toObject(e,this)},proto.flow.access.SendTransactionRequest.toObject=function(e,t){var o,r={transaction:(o=t.getTransaction())&&u.Transaction.toObject(e,o)};return e&&(r.$jspbMessageInstance=t),r}),proto.flow.access.SendTransactionRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.SendTransactionRequest;return proto.flow.access.SendTransactionRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.SendTransactionRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=new u.Transaction;t.readMessage(o,u.Transaction.deserializeBinaryFromReader),e.setTransaction(o);break;default:t.skipField();}}return e},proto.flow.access.SendTransactionRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.SendTransactionRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.SendTransactionRequest.serializeBinaryToWriter=function(e,t){var o;null!=(o=e.getTransaction())&&t.writeMessage(1,o,u.Transaction.serializeBinaryToWriter);},proto.flow.access.SendTransactionRequest.prototype.getTransaction=function(){return r.Message.getWrapperField(this,u.Transaction,1)},proto.flow.access.SendTransactionRequest.prototype.setTransaction=function(e){return r.Message.setWrapperField(this,1,e)},proto.flow.access.SendTransactionRequest.prototype.clearTransaction=function(){return this.setTransaction(void 0)},proto.flow.access.SendTransactionRequest.prototype.hasTransaction=function(){return null!=r.Message.getField(this,1)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.SendTransactionResponse.prototype.toObject=function(e){return proto.flow.access.SendTransactionResponse.toObject(e,this)},proto.flow.access.SendTransactionResponse.toObject=function(e,t){var o={id:t.getId_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.SendTransactionResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.SendTransactionResponse;return proto.flow.access.SendTransactionResponse.deserializeBinaryFromReader(o,t)},proto.flow.access.SendTransactionResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setId(o);break;default:t.skipField();}}return e},proto.flow.access.SendTransactionResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.SendTransactionResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.SendTransactionResponse.serializeBinaryToWriter=function(e,t){var o;(o=e.getId_asU8()).length>0&&t.writeBytes(1,o);},proto.flow.access.SendTransactionResponse.prototype.getId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.SendTransactionResponse.prototype.getId_asB64=function(){return r.Message.bytesAsB64(this.getId())},proto.flow.access.SendTransactionResponse.prototype.getId_asU8=function(){return r.Message.bytesAsU8(this.getId())},proto.flow.access.SendTransactionResponse.prototype.setId=function(e){return r.Message.setProto3BytesField(this,1,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetTransactionRequest.prototype.toObject=function(e){return proto.flow.access.GetTransactionRequest.toObject(e,this)},proto.flow.access.GetTransactionRequest.toObject=function(e,t){var o={id:t.getId_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetTransactionRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetTransactionRequest;return proto.flow.access.GetTransactionRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetTransactionRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setId(o);break;default:t.skipField();}}return e},proto.flow.access.GetTransactionRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetTransactionRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetTransactionRequest.serializeBinaryToWriter=function(e,t){var o;(o=e.getId_asU8()).length>0&&t.writeBytes(1,o);},proto.flow.access.GetTransactionRequest.prototype.getId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.GetTransactionRequest.prototype.getId_asB64=function(){return r.Message.bytesAsB64(this.getId())},proto.flow.access.GetTransactionRequest.prototype.getId_asU8=function(){return r.Message.bytesAsU8(this.getId())},proto.flow.access.GetTransactionRequest.prototype.setId=function(e){return r.Message.setProto3BytesField(this,1,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.TransactionResponse.prototype.toObject=function(e){return proto.flow.access.TransactionResponse.toObject(e,this)},proto.flow.access.TransactionResponse.toObject=function(e,t){var o,r={transaction:(o=t.getTransaction())&&u.Transaction.toObject(e,o)};return e&&(r.$jspbMessageInstance=t),r}),proto.flow.access.TransactionResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.TransactionResponse;return proto.flow.access.TransactionResponse.deserializeBinaryFromReader(o,t)},proto.flow.access.TransactionResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=new u.Transaction;t.readMessage(o,u.Transaction.deserializeBinaryFromReader),e.setTransaction(o);break;default:t.skipField();}}return e},proto.flow.access.TransactionResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.TransactionResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.TransactionResponse.serializeBinaryToWriter=function(e,t){var o;null!=(o=e.getTransaction())&&t.writeMessage(1,o,u.Transaction.serializeBinaryToWriter);},proto.flow.access.TransactionResponse.prototype.getTransaction=function(){return r.Message.getWrapperField(this,u.Transaction,1)},proto.flow.access.TransactionResponse.prototype.setTransaction=function(e){return r.Message.setWrapperField(this,1,e)},proto.flow.access.TransactionResponse.prototype.clearTransaction=function(){return this.setTransaction(void 0)},proto.flow.access.TransactionResponse.prototype.hasTransaction=function(){return null!=r.Message.getField(this,1)},proto.flow.access.TransactionResultResponse.repeatedFields_=[4],r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.TransactionResultResponse.prototype.toObject=function(e){return proto.flow.access.TransactionResultResponse.toObject(e,this)},proto.flow.access.TransactionResultResponse.toObject=function(e,t){var o={status:r.Message.getFieldWithDefault(t,1,0),statusCode:r.Message.getFieldWithDefault(t,2,0),errorMessage:r.Message.getFieldWithDefault(t,3,""),eventsList:r.Message.toObjectList(t.getEventsList(),c.Event.toObject,e)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.TransactionResultResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.TransactionResultResponse;return proto.flow.access.TransactionResultResponse.deserializeBinaryFromReader(o,t)},proto.flow.access.TransactionResultResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readEnum();e.setStatus(o);break;case 2:o=t.readUint32();e.setStatusCode(o);break;case 3:o=t.readString();e.setErrorMessage(o);break;case 4:o=new c.Event;t.readMessage(o,c.Event.deserializeBinaryFromReader),e.addEvents(o);break;default:t.skipField();}}return e},proto.flow.access.TransactionResultResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.TransactionResultResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.TransactionResultResponse.serializeBinaryToWriter=function(e,t){var o=void 0;0!==(o=e.getStatus())&&t.writeEnum(1,o),0!==(o=e.getStatusCode())&&t.writeUint32(2,o),(o=e.getErrorMessage()).length>0&&t.writeString(3,o),(o=e.getEventsList()).length>0&&t.writeRepeatedMessage(4,o,c.Event.serializeBinaryToWriter);},proto.flow.access.TransactionResultResponse.prototype.getStatus=function(){return r.Message.getFieldWithDefault(this,1,0)},proto.flow.access.TransactionResultResponse.prototype.setStatus=function(e){return r.Message.setProto3EnumField(this,1,e)},proto.flow.access.TransactionResultResponse.prototype.getStatusCode=function(){return r.Message.getFieldWithDefault(this,2,0)},proto.flow.access.TransactionResultResponse.prototype.setStatusCode=function(e){return r.Message.setProto3IntField(this,2,e)},proto.flow.access.TransactionResultResponse.prototype.getErrorMessage=function(){return r.Message.getFieldWithDefault(this,3,"")},proto.flow.access.TransactionResultResponse.prototype.setErrorMessage=function(e){return r.Message.setProto3StringField(this,3,e)},proto.flow.access.TransactionResultResponse.prototype.getEventsList=function(){return r.Message.getRepeatedWrapperField(this,c.Event,4)},proto.flow.access.TransactionResultResponse.prototype.setEventsList=function(e){return r.Message.setRepeatedWrapperField(this,4,e)},proto.flow.access.TransactionResultResponse.prototype.addEvents=function(e,t){return r.Message.addToRepeatedWrapperField(this,4,e,proto.flow.entities.Event,t)},proto.flow.access.TransactionResultResponse.prototype.clearEventsList=function(){return this.setEventsList([])},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetAccountRequest.prototype.toObject=function(e){return proto.flow.access.GetAccountRequest.toObject(e,this)},proto.flow.access.GetAccountRequest.toObject=function(e,t){var o={address:t.getAddress_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetAccountRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetAccountRequest;return proto.flow.access.GetAccountRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetAccountRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setAddress(o);break;default:t.skipField();}}return e},proto.flow.access.GetAccountRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetAccountRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetAccountRequest.serializeBinaryToWriter=function(e,t){var o;(o=e.getAddress_asU8()).length>0&&t.writeBytes(1,o);},proto.flow.access.GetAccountRequest.prototype.getAddress=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.GetAccountRequest.prototype.getAddress_asB64=function(){return r.Message.bytesAsB64(this.getAddress())},proto.flow.access.GetAccountRequest.prototype.getAddress_asU8=function(){return r.Message.bytesAsU8(this.getAddress())},proto.flow.access.GetAccountRequest.prototype.setAddress=function(e){return r.Message.setProto3BytesField(this,1,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetAccountResponse.prototype.toObject=function(e){return proto.flow.access.GetAccountResponse.toObject(e,this)},proto.flow.access.GetAccountResponse.toObject=function(e,t){var o,r={account:(o=t.getAccount())&&i.Account.toObject(e,o)};return e&&(r.$jspbMessageInstance=t),r}),proto.flow.access.GetAccountResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetAccountResponse;return proto.flow.access.GetAccountResponse.deserializeBinaryFromReader(o,t)},proto.flow.access.GetAccountResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=new i.Account;t.readMessage(o,i.Account.deserializeBinaryFromReader),e.setAccount(o);break;default:t.skipField();}}return e},proto.flow.access.GetAccountResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetAccountResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetAccountResponse.serializeBinaryToWriter=function(e,t){var o;null!=(o=e.getAccount())&&t.writeMessage(1,o,i.Account.serializeBinaryToWriter);},proto.flow.access.GetAccountResponse.prototype.getAccount=function(){return r.Message.getWrapperField(this,i.Account,1)},proto.flow.access.GetAccountResponse.prototype.setAccount=function(e){return r.Message.setWrapperField(this,1,e)},proto.flow.access.GetAccountResponse.prototype.clearAccount=function(){return this.setAccount(void 0)},proto.flow.access.GetAccountResponse.prototype.hasAccount=function(){return null!=r.Message.getField(this,1)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetAccountAtLatestBlockRequest.prototype.toObject=function(e){return proto.flow.access.GetAccountAtLatestBlockRequest.toObject(e,this)},proto.flow.access.GetAccountAtLatestBlockRequest.toObject=function(e,t){var o={address:t.getAddress_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetAccountAtLatestBlockRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetAccountAtLatestBlockRequest;return proto.flow.access.GetAccountAtLatestBlockRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetAccountAtLatestBlockRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setAddress(o);break;default:t.skipField();}}return e},proto.flow.access.GetAccountAtLatestBlockRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetAccountAtLatestBlockRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetAccountAtLatestBlockRequest.serializeBinaryToWriter=function(e,t){var o;(o=e.getAddress_asU8()).length>0&&t.writeBytes(1,o);},proto.flow.access.GetAccountAtLatestBlockRequest.prototype.getAddress=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.GetAccountAtLatestBlockRequest.prototype.getAddress_asB64=function(){return r.Message.bytesAsB64(this.getAddress())},proto.flow.access.GetAccountAtLatestBlockRequest.prototype.getAddress_asU8=function(){return r.Message.bytesAsU8(this.getAddress())},proto.flow.access.GetAccountAtLatestBlockRequest.prototype.setAddress=function(e){return r.Message.setProto3BytesField(this,1,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.AccountResponse.prototype.toObject=function(e){return proto.flow.access.AccountResponse.toObject(e,this)},proto.flow.access.AccountResponse.toObject=function(e,t){var o,r={account:(o=t.getAccount())&&i.Account.toObject(e,o)};return e&&(r.$jspbMessageInstance=t),r}),proto.flow.access.AccountResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.AccountResponse;return proto.flow.access.AccountResponse.deserializeBinaryFromReader(o,t)},proto.flow.access.AccountResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=new i.Account;t.readMessage(o,i.Account.deserializeBinaryFromReader),e.setAccount(o);break;default:t.skipField();}}return e},proto.flow.access.AccountResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.AccountResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.AccountResponse.serializeBinaryToWriter=function(e,t){var o;null!=(o=e.getAccount())&&t.writeMessage(1,o,i.Account.serializeBinaryToWriter);},proto.flow.access.AccountResponse.prototype.getAccount=function(){return r.Message.getWrapperField(this,i.Account,1)},proto.flow.access.AccountResponse.prototype.setAccount=function(e){return r.Message.setWrapperField(this,1,e)},proto.flow.access.AccountResponse.prototype.clearAccount=function(){return this.setAccount(void 0)},proto.flow.access.AccountResponse.prototype.hasAccount=function(){return null!=r.Message.getField(this,1)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetAccountAtBlockHeightRequest.prototype.toObject=function(e){return proto.flow.access.GetAccountAtBlockHeightRequest.toObject(e,this)},proto.flow.access.GetAccountAtBlockHeightRequest.toObject=function(e,t){var o={address:t.getAddress_asB64(),blockHeight:r.Message.getFieldWithDefault(t,2,0)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetAccountAtBlockHeightRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetAccountAtBlockHeightRequest;return proto.flow.access.GetAccountAtBlockHeightRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetAccountAtBlockHeightRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setAddress(o);break;case 2:o=t.readUint64();e.setBlockHeight(o);break;default:t.skipField();}}return e},proto.flow.access.GetAccountAtBlockHeightRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetAccountAtBlockHeightRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetAccountAtBlockHeightRequest.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getAddress_asU8()).length>0&&t.writeBytes(1,o),0!==(o=e.getBlockHeight())&&t.writeUint64(2,o);},proto.flow.access.GetAccountAtBlockHeightRequest.prototype.getAddress=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.GetAccountAtBlockHeightRequest.prototype.getAddress_asB64=function(){return r.Message.bytesAsB64(this.getAddress())},proto.flow.access.GetAccountAtBlockHeightRequest.prototype.getAddress_asU8=function(){return r.Message.bytesAsU8(this.getAddress())},proto.flow.access.GetAccountAtBlockHeightRequest.prototype.setAddress=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.access.GetAccountAtBlockHeightRequest.prototype.getBlockHeight=function(){return r.Message.getFieldWithDefault(this,2,0)},proto.flow.access.GetAccountAtBlockHeightRequest.prototype.setBlockHeight=function(e){return r.Message.setProto3IntField(this,2,e)},proto.flow.access.ExecuteScriptAtLatestBlockRequest.repeatedFields_=[2],r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.ExecuteScriptAtLatestBlockRequest.prototype.toObject=function(e){return proto.flow.access.ExecuteScriptAtLatestBlockRequest.toObject(e,this)},proto.flow.access.ExecuteScriptAtLatestBlockRequest.toObject=function(e,t){var o={script:t.getScript_asB64(),argumentsList:t.getArgumentsList_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.ExecuteScriptAtLatestBlockRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.ExecuteScriptAtLatestBlockRequest;return proto.flow.access.ExecuteScriptAtLatestBlockRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.ExecuteScriptAtLatestBlockRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setScript(o);break;case 2:o=t.readBytes();e.addArguments(o);break;default:t.skipField();}}return e},proto.flow.access.ExecuteScriptAtLatestBlockRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.ExecuteScriptAtLatestBlockRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.ExecuteScriptAtLatestBlockRequest.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getScript_asU8()).length>0&&t.writeBytes(1,o),(o=e.getArgumentsList_asU8()).length>0&&t.writeRepeatedBytes(2,o);},proto.flow.access.ExecuteScriptAtLatestBlockRequest.prototype.getScript=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.ExecuteScriptAtLatestBlockRequest.prototype.getScript_asB64=function(){return r.Message.bytesAsB64(this.getScript())},proto.flow.access.ExecuteScriptAtLatestBlockRequest.prototype.getScript_asU8=function(){return r.Message.bytesAsU8(this.getScript())},proto.flow.access.ExecuteScriptAtLatestBlockRequest.prototype.setScript=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.access.ExecuteScriptAtLatestBlockRequest.prototype.getArgumentsList=function(){return r.Message.getRepeatedField(this,2)},proto.flow.access.ExecuteScriptAtLatestBlockRequest.prototype.getArgumentsList_asB64=function(){return r.Message.bytesListAsB64(this.getArgumentsList())},proto.flow.access.ExecuteScriptAtLatestBlockRequest.prototype.getArgumentsList_asU8=function(){return r.Message.bytesListAsU8(this.getArgumentsList())},proto.flow.access.ExecuteScriptAtLatestBlockRequest.prototype.setArgumentsList=function(e){return r.Message.setField(this,2,e||[])},proto.flow.access.ExecuteScriptAtLatestBlockRequest.prototype.addArguments=function(e,t){return r.Message.addToRepeatedField(this,2,e,t)},proto.flow.access.ExecuteScriptAtLatestBlockRequest.prototype.clearArgumentsList=function(){return this.setArgumentsList([])},proto.flow.access.ExecuteScriptAtBlockIDRequest.repeatedFields_=[3],r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.toObject=function(e){return proto.flow.access.ExecuteScriptAtBlockIDRequest.toObject(e,this)},proto.flow.access.ExecuteScriptAtBlockIDRequest.toObject=function(e,t){var o={blockId:t.getBlockId_asB64(),script:t.getScript_asB64(),argumentsList:t.getArgumentsList_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.ExecuteScriptAtBlockIDRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.ExecuteScriptAtBlockIDRequest;return proto.flow.access.ExecuteScriptAtBlockIDRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.ExecuteScriptAtBlockIDRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setBlockId(o);break;case 2:o=t.readBytes();e.setScript(o);break;case 3:o=t.readBytes();e.addArguments(o);break;default:t.skipField();}}return e},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.ExecuteScriptAtBlockIDRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.ExecuteScriptAtBlockIDRequest.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getBlockId_asU8()).length>0&&t.writeBytes(1,o),(o=e.getScript_asU8()).length>0&&t.writeBytes(2,o),(o=e.getArgumentsList_asU8()).length>0&&t.writeRepeatedBytes(3,o);},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.getBlockId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.getBlockId_asB64=function(){return r.Message.bytesAsB64(this.getBlockId())},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.getBlockId_asU8=function(){return r.Message.bytesAsU8(this.getBlockId())},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.setBlockId=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.getScript=function(){return r.Message.getFieldWithDefault(this,2,"")},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.getScript_asB64=function(){return r.Message.bytesAsB64(this.getScript())},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.getScript_asU8=function(){return r.Message.bytesAsU8(this.getScript())},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.setScript=function(e){return r.Message.setProto3BytesField(this,2,e)},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.getArgumentsList=function(){return r.Message.getRepeatedField(this,3)},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.getArgumentsList_asB64=function(){return r.Message.bytesListAsB64(this.getArgumentsList())},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.getArgumentsList_asU8=function(){return r.Message.bytesListAsU8(this.getArgumentsList())},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.setArgumentsList=function(e){return r.Message.setField(this,3,e||[])},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.addArguments=function(e,t){return r.Message.addToRepeatedField(this,3,e,t)},proto.flow.access.ExecuteScriptAtBlockIDRequest.prototype.clearArgumentsList=function(){return this.setArgumentsList([])},proto.flow.access.ExecuteScriptAtBlockHeightRequest.repeatedFields_=[3],r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.toObject=function(e){return proto.flow.access.ExecuteScriptAtBlockHeightRequest.toObject(e,this)},proto.flow.access.ExecuteScriptAtBlockHeightRequest.toObject=function(e,t){var o={blockHeight:r.Message.getFieldWithDefault(t,1,0),script:t.getScript_asB64(),argumentsList:t.getArgumentsList_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.ExecuteScriptAtBlockHeightRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.ExecuteScriptAtBlockHeightRequest;return proto.flow.access.ExecuteScriptAtBlockHeightRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.ExecuteScriptAtBlockHeightRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readUint64();e.setBlockHeight(o);break;case 2:o=t.readBytes();e.setScript(o);break;case 3:o=t.readBytes();e.addArguments(o);break;default:t.skipField();}}return e},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.ExecuteScriptAtBlockHeightRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.ExecuteScriptAtBlockHeightRequest.serializeBinaryToWriter=function(e,t){var o=void 0;0!==(o=e.getBlockHeight())&&t.writeUint64(1,o),(o=e.getScript_asU8()).length>0&&t.writeBytes(2,o),(o=e.getArgumentsList_asU8()).length>0&&t.writeRepeatedBytes(3,o);},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.getBlockHeight=function(){return r.Message.getFieldWithDefault(this,1,0)},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.setBlockHeight=function(e){return r.Message.setProto3IntField(this,1,e)},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.getScript=function(){return r.Message.getFieldWithDefault(this,2,"")},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.getScript_asB64=function(){return r.Message.bytesAsB64(this.getScript())},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.getScript_asU8=function(){return r.Message.bytesAsU8(this.getScript())},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.setScript=function(e){return r.Message.setProto3BytesField(this,2,e)},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.getArgumentsList=function(){return r.Message.getRepeatedField(this,3)},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.getArgumentsList_asB64=function(){return r.Message.bytesListAsB64(this.getArgumentsList())},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.getArgumentsList_asU8=function(){return r.Message.bytesListAsU8(this.getArgumentsList())},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.setArgumentsList=function(e){return r.Message.setField(this,3,e||[])},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.addArguments=function(e,t){return r.Message.addToRepeatedField(this,3,e,t)},proto.flow.access.ExecuteScriptAtBlockHeightRequest.prototype.clearArgumentsList=function(){return this.setArgumentsList([])},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.ExecuteScriptResponse.prototype.toObject=function(e){return proto.flow.access.ExecuteScriptResponse.toObject(e,this)},proto.flow.access.ExecuteScriptResponse.toObject=function(e,t){var o={value:t.getValue_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.ExecuteScriptResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.ExecuteScriptResponse;return proto.flow.access.ExecuteScriptResponse.deserializeBinaryFromReader(o,t)},proto.flow.access.ExecuteScriptResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setValue(o);break;default:t.skipField();}}return e},proto.flow.access.ExecuteScriptResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.ExecuteScriptResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.ExecuteScriptResponse.serializeBinaryToWriter=function(e,t){var o;(o=e.getValue_asU8()).length>0&&t.writeBytes(1,o);},proto.flow.access.ExecuteScriptResponse.prototype.getValue=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.ExecuteScriptResponse.prototype.getValue_asB64=function(){return r.Message.bytesAsB64(this.getValue())},proto.flow.access.ExecuteScriptResponse.prototype.getValue_asU8=function(){return r.Message.bytesAsU8(this.getValue())},proto.flow.access.ExecuteScriptResponse.prototype.setValue=function(e){return r.Message.setProto3BytesField(this,1,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetEventsForHeightRangeRequest.prototype.toObject=function(e){return proto.flow.access.GetEventsForHeightRangeRequest.toObject(e,this)},proto.flow.access.GetEventsForHeightRangeRequest.toObject=function(e,t){var o={type:r.Message.getFieldWithDefault(t,1,""),startHeight:r.Message.getFieldWithDefault(t,2,0),endHeight:r.Message.getFieldWithDefault(t,3,0)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetEventsForHeightRangeRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetEventsForHeightRangeRequest;return proto.flow.access.GetEventsForHeightRangeRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetEventsForHeightRangeRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readString();e.setType(o);break;case 2:o=t.readUint64();e.setStartHeight(o);break;case 3:o=t.readUint64();e.setEndHeight(o);break;default:t.skipField();}}return e},proto.flow.access.GetEventsForHeightRangeRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetEventsForHeightRangeRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetEventsForHeightRangeRequest.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getType()).length>0&&t.writeString(1,o),0!==(o=e.getStartHeight())&&t.writeUint64(2,o),0!==(o=e.getEndHeight())&&t.writeUint64(3,o);},proto.flow.access.GetEventsForHeightRangeRequest.prototype.getType=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.GetEventsForHeightRangeRequest.prototype.setType=function(e){return r.Message.setProto3StringField(this,1,e)},proto.flow.access.GetEventsForHeightRangeRequest.prototype.getStartHeight=function(){return r.Message.getFieldWithDefault(this,2,0)},proto.flow.access.GetEventsForHeightRangeRequest.prototype.setStartHeight=function(e){return r.Message.setProto3IntField(this,2,e)},proto.flow.access.GetEventsForHeightRangeRequest.prototype.getEndHeight=function(){return r.Message.getFieldWithDefault(this,3,0)},proto.flow.access.GetEventsForHeightRangeRequest.prototype.setEndHeight=function(e){return r.Message.setProto3IntField(this,3,e)},proto.flow.access.GetEventsForBlockIDsRequest.repeatedFields_=[2],r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetEventsForBlockIDsRequest.prototype.toObject=function(e){return proto.flow.access.GetEventsForBlockIDsRequest.toObject(e,this)},proto.flow.access.GetEventsForBlockIDsRequest.toObject=function(e,t){var o={type:r.Message.getFieldWithDefault(t,1,""),blockIdsList:t.getBlockIdsList_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetEventsForBlockIDsRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetEventsForBlockIDsRequest;return proto.flow.access.GetEventsForBlockIDsRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetEventsForBlockIDsRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readString();e.setType(o);break;case 2:o=t.readBytes();e.addBlockIds(o);break;default:t.skipField();}}return e},proto.flow.access.GetEventsForBlockIDsRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetEventsForBlockIDsRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetEventsForBlockIDsRequest.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getType()).length>0&&t.writeString(1,o),(o=e.getBlockIdsList_asU8()).length>0&&t.writeRepeatedBytes(2,o);},proto.flow.access.GetEventsForBlockIDsRequest.prototype.getType=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.GetEventsForBlockIDsRequest.prototype.setType=function(e){return r.Message.setProto3StringField(this,1,e)},proto.flow.access.GetEventsForBlockIDsRequest.prototype.getBlockIdsList=function(){return r.Message.getRepeatedField(this,2)},proto.flow.access.GetEventsForBlockIDsRequest.prototype.getBlockIdsList_asB64=function(){return r.Message.bytesListAsB64(this.getBlockIdsList())},proto.flow.access.GetEventsForBlockIDsRequest.prototype.getBlockIdsList_asU8=function(){return r.Message.bytesListAsU8(this.getBlockIdsList())},proto.flow.access.GetEventsForBlockIDsRequest.prototype.setBlockIdsList=function(e){return r.Message.setField(this,2,e||[])},proto.flow.access.GetEventsForBlockIDsRequest.prototype.addBlockIds=function(e,t){return r.Message.addToRepeatedField(this,2,e,t)},proto.flow.access.GetEventsForBlockIDsRequest.prototype.clearBlockIdsList=function(){return this.setBlockIdsList([])},proto.flow.access.EventsResponse.repeatedFields_=[1],r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.EventsResponse.prototype.toObject=function(e){return proto.flow.access.EventsResponse.toObject(e,this)},proto.flow.access.EventsResponse.toObject=function(e,t){var o={resultsList:r.Message.toObjectList(t.getResultsList(),proto.flow.access.EventsResponse.Result.toObject,e)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.EventsResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.EventsResponse;return proto.flow.access.EventsResponse.deserializeBinaryFromReader(o,t)},proto.flow.access.EventsResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=new proto.flow.access.EventsResponse.Result;t.readMessage(o,proto.flow.access.EventsResponse.Result.deserializeBinaryFromReader),e.addResults(o);break;default:t.skipField();}}return e},proto.flow.access.EventsResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.EventsResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.EventsResponse.serializeBinaryToWriter=function(e,t){var o;(o=e.getResultsList()).length>0&&t.writeRepeatedMessage(1,o,proto.flow.access.EventsResponse.Result.serializeBinaryToWriter);},proto.flow.access.EventsResponse.Result.repeatedFields_=[3],r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.EventsResponse.Result.prototype.toObject=function(e){return proto.flow.access.EventsResponse.Result.toObject(e,this)},proto.flow.access.EventsResponse.Result.toObject=function(e,t){var o,s={blockId:t.getBlockId_asB64(),blockHeight:r.Message.getFieldWithDefault(t,2,0),eventsList:r.Message.toObjectList(t.getEventsList(),c.Event.toObject,e),blockTimestamp:(o=t.getBlockTimestamp())&&p.Timestamp.toObject(e,o)};return e&&(s.$jspbMessageInstance=t),s}),proto.flow.access.EventsResponse.Result.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.EventsResponse.Result;return proto.flow.access.EventsResponse.Result.deserializeBinaryFromReader(o,t)},proto.flow.access.EventsResponse.Result.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setBlockId(o);break;case 2:o=t.readUint64();e.setBlockHeight(o);break;case 3:o=new c.Event;t.readMessage(o,c.Event.deserializeBinaryFromReader),e.addEvents(o);break;case 4:o=new p.Timestamp;t.readMessage(o,p.Timestamp.deserializeBinaryFromReader),e.setBlockTimestamp(o);break;default:t.skipField();}}return e},proto.flow.access.EventsResponse.Result.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.EventsResponse.Result.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.EventsResponse.Result.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getBlockId_asU8()).length>0&&t.writeBytes(1,o),0!==(o=e.getBlockHeight())&&t.writeUint64(2,o),(o=e.getEventsList()).length>0&&t.writeRepeatedMessage(3,o,c.Event.serializeBinaryToWriter),null!=(o=e.getBlockTimestamp())&&t.writeMessage(4,o,p.Timestamp.serializeBinaryToWriter);},proto.flow.access.EventsResponse.Result.prototype.getBlockId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.EventsResponse.Result.prototype.getBlockId_asB64=function(){return r.Message.bytesAsB64(this.getBlockId())},proto.flow.access.EventsResponse.Result.prototype.getBlockId_asU8=function(){return r.Message.bytesAsU8(this.getBlockId())},proto.flow.access.EventsResponse.Result.prototype.setBlockId=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.access.EventsResponse.Result.prototype.getBlockHeight=function(){return r.Message.getFieldWithDefault(this,2,0)},proto.flow.access.EventsResponse.Result.prototype.setBlockHeight=function(e){return r.Message.setProto3IntField(this,2,e)},proto.flow.access.EventsResponse.Result.prototype.getEventsList=function(){return r.Message.getRepeatedWrapperField(this,c.Event,3)},proto.flow.access.EventsResponse.Result.prototype.setEventsList=function(e){return r.Message.setRepeatedWrapperField(this,3,e)},proto.flow.access.EventsResponse.Result.prototype.addEvents=function(e,t){return r.Message.addToRepeatedWrapperField(this,3,e,proto.flow.entities.Event,t)},proto.flow.access.EventsResponse.Result.prototype.clearEventsList=function(){return this.setEventsList([])},proto.flow.access.EventsResponse.Result.prototype.getBlockTimestamp=function(){return r.Message.getWrapperField(this,p.Timestamp,4)},proto.flow.access.EventsResponse.Result.prototype.setBlockTimestamp=function(e){return r.Message.setWrapperField(this,4,e)},proto.flow.access.EventsResponse.Result.prototype.clearBlockTimestamp=function(){return this.setBlockTimestamp(void 0)},proto.flow.access.EventsResponse.Result.prototype.hasBlockTimestamp=function(){return null!=r.Message.getField(this,4)},proto.flow.access.EventsResponse.prototype.getResultsList=function(){return r.Message.getRepeatedWrapperField(this,proto.flow.access.EventsResponse.Result,1)},proto.flow.access.EventsResponse.prototype.setResultsList=function(e){return r.Message.setRepeatedWrapperField(this,1,e)},proto.flow.access.EventsResponse.prototype.addResults=function(e,t){return r.Message.addToRepeatedWrapperField(this,1,e,proto.flow.access.EventsResponse.Result,t)},proto.flow.access.EventsResponse.prototype.clearResultsList=function(){return this.setResultsList([])},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetNetworkParametersRequest.prototype.toObject=function(e){return proto.flow.access.GetNetworkParametersRequest.toObject(e,this)},proto.flow.access.GetNetworkParametersRequest.toObject=function(e,t){var o={};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetNetworkParametersRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetNetworkParametersRequest;return proto.flow.access.GetNetworkParametersRequest.deserializeBinaryFromReader(o,t)},proto.flow.access.GetNetworkParametersRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){t.getFieldNumber();t.skipField();}return e},proto.flow.access.GetNetworkParametersRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetNetworkParametersRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetNetworkParametersRequest.serializeBinaryToWriter=function(e,t){},r.Message.GENERATE_TO_OBJECT&&(proto.flow.access.GetNetworkParametersResponse.prototype.toObject=function(e){return proto.flow.access.GetNetworkParametersResponse.toObject(e,this)},proto.flow.access.GetNetworkParametersResponse.toObject=function(e,t){var o={chainId:r.Message.getFieldWithDefault(t,1,"")};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.access.GetNetworkParametersResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.access.GetNetworkParametersResponse;return proto.flow.access.GetNetworkParametersResponse.deserializeBinaryFromReader(o,t)},proto.flow.access.GetNetworkParametersResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readString();e.setChainId(o);break;default:t.skipField();}}return e},proto.flow.access.GetNetworkParametersResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.access.GetNetworkParametersResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.access.GetNetworkParametersResponse.serializeBinaryToWriter=function(e,t){var o;(o=e.getChainId()).length>0&&t.writeString(1,o);},proto.flow.access.GetNetworkParametersResponse.prototype.getChainId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.access.GetNetworkParametersResponse.prototype.setChainId=function(e){return r.Message.setProto3StringField(this,1,e)},s.object.extend(t,proto.flow.access);},function(e,t,o){var r=o(0),s=r,n=Function("return this")(),i=o(6);s.object.extend(proto,i),s.exportSymbol("proto.flow.entities.BlockHeader",null,n),proto.flow.entities.BlockHeader=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.entities.BlockHeader,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.entities.BlockHeader.displayName="proto.flow.entities.BlockHeader"),r.Message.GENERATE_TO_OBJECT&&(proto.flow.entities.BlockHeader.prototype.toObject=function(e){return proto.flow.entities.BlockHeader.toObject(e,this)},proto.flow.entities.BlockHeader.toObject=function(e,t){var o,s={id:t.getId_asB64(),parentId:t.getParentId_asB64(),height:r.Message.getFieldWithDefault(t,3,0),timestamp:(o=t.getTimestamp())&&i.Timestamp.toObject(e,o)};return e&&(s.$jspbMessageInstance=t),s}),proto.flow.entities.BlockHeader.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.entities.BlockHeader;return proto.flow.entities.BlockHeader.deserializeBinaryFromReader(o,t)},proto.flow.entities.BlockHeader.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setId(o);break;case 2:o=t.readBytes();e.setParentId(o);break;case 3:o=t.readUint64();e.setHeight(o);break;case 4:o=new i.Timestamp;t.readMessage(o,i.Timestamp.deserializeBinaryFromReader),e.setTimestamp(o);break;default:t.skipField();}}return e},proto.flow.entities.BlockHeader.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.entities.BlockHeader.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.entities.BlockHeader.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getId_asU8()).length>0&&t.writeBytes(1,o),(o=e.getParentId_asU8()).length>0&&t.writeBytes(2,o),0!==(o=e.getHeight())&&t.writeUint64(3,o),null!=(o=e.getTimestamp())&&t.writeMessage(4,o,i.Timestamp.serializeBinaryToWriter);},proto.flow.entities.BlockHeader.prototype.getId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.entities.BlockHeader.prototype.getId_asB64=function(){return r.Message.bytesAsB64(this.getId())},proto.flow.entities.BlockHeader.prototype.getId_asU8=function(){return r.Message.bytesAsU8(this.getId())},proto.flow.entities.BlockHeader.prototype.setId=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.entities.BlockHeader.prototype.getParentId=function(){return r.Message.getFieldWithDefault(this,2,"")},proto.flow.entities.BlockHeader.prototype.getParentId_asB64=function(){return r.Message.bytesAsB64(this.getParentId())},proto.flow.entities.BlockHeader.prototype.getParentId_asU8=function(){return r.Message.bytesAsU8(this.getParentId())},proto.flow.entities.BlockHeader.prototype.setParentId=function(e){return r.Message.setProto3BytesField(this,2,e)},proto.flow.entities.BlockHeader.prototype.getHeight=function(){return r.Message.getFieldWithDefault(this,3,0)},proto.flow.entities.BlockHeader.prototype.setHeight=function(e){return r.Message.setProto3IntField(this,3,e)},proto.flow.entities.BlockHeader.prototype.getTimestamp=function(){return r.Message.getWrapperField(this,i.Timestamp,4)},proto.flow.entities.BlockHeader.prototype.setTimestamp=function(e){return r.Message.setWrapperField(this,4,e)},proto.flow.entities.BlockHeader.prototype.clearTimestamp=function(){return this.setTimestamp(void 0)},proto.flow.entities.BlockHeader.prototype.hasTimestamp=function(){return null!=r.Message.getField(this,4)},s.object.extend(t,proto.flow.entities);},function(e,t,o){var r=o(0),s=r,n=Function("return this")();s.exportSymbol("proto.google.protobuf.Timestamp",null,n),proto.google.protobuf.Timestamp=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.google.protobuf.Timestamp,r.Message),s.DEBUG&&!COMPILED&&(proto.google.protobuf.Timestamp.displayName="proto.google.protobuf.Timestamp"),r.Message.GENERATE_TO_OBJECT&&(proto.google.protobuf.Timestamp.prototype.toObject=function(e){return proto.google.protobuf.Timestamp.toObject(e,this)},proto.google.protobuf.Timestamp.toObject=function(e,t){var o={seconds:r.Message.getFieldWithDefault(t,1,0),nanos:r.Message.getFieldWithDefault(t,2,0)};return e&&(o.$jspbMessageInstance=t),o}),proto.google.protobuf.Timestamp.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.google.protobuf.Timestamp;return proto.google.protobuf.Timestamp.deserializeBinaryFromReader(o,t)},proto.google.protobuf.Timestamp.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readInt64();e.setSeconds(o);break;case 2:o=t.readInt32();e.setNanos(o);break;default:t.skipField();}}return e},proto.google.protobuf.Timestamp.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.google.protobuf.Timestamp.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.google.protobuf.Timestamp.serializeBinaryToWriter=function(e,t){var o=void 0;0!==(o=e.getSeconds())&&t.writeInt64(1,o),0!==(o=e.getNanos())&&t.writeInt32(2,o);},proto.google.protobuf.Timestamp.prototype.getSeconds=function(){return r.Message.getFieldWithDefault(this,1,0)},proto.google.protobuf.Timestamp.prototype.setSeconds=function(e){return r.Message.setProto3IntField(this,1,e)},proto.google.protobuf.Timestamp.prototype.getNanos=function(){return r.Message.getFieldWithDefault(this,2,0)},proto.google.protobuf.Timestamp.prototype.setNanos=function(e){return r.Message.setProto3IntField(this,2,e)},s.object.extend(t,proto.google.protobuf),proto.google.protobuf.Timestamp.prototype.toDate=function(){var e=this.getSeconds(),t=this.getNanos();return new Date(1e3*e+t/1e6)},proto.google.protobuf.Timestamp.prototype.fromDate=function(e){this.setSeconds(Math.floor(e.getTime()/1e3)),this.setNanos(1e6*e.getMilliseconds());},proto.google.protobuf.Timestamp.fromDate=function(e){var t=new proto.google.protobuf.Timestamp;return t.fromDate(e),t};},function(e,t,o){var r=o(0),s=r,n=Function("return this")(),i=o(6);s.object.extend(proto,i);var a=o(2);s.object.extend(proto,a);var g=o(8);s.object.extend(proto,g),s.exportSymbol("proto.flow.entities.Block",null,n),proto.flow.entities.Block=function(e){r.Message.initialize(this,e,0,-1,proto.flow.entities.Block.repeatedFields_,null);},s.inherits(proto.flow.entities.Block,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.entities.Block.displayName="proto.flow.entities.Block"),proto.flow.entities.Block.repeatedFields_=[5,6,7],r.Message.GENERATE_TO_OBJECT&&(proto.flow.entities.Block.prototype.toObject=function(e){return proto.flow.entities.Block.toObject(e,this)},proto.flow.entities.Block.toObject=function(e,t){var o,s={id:t.getId_asB64(),parentId:t.getParentId_asB64(),height:r.Message.getFieldWithDefault(t,3,0),timestamp:(o=t.getTimestamp())&&i.Timestamp.toObject(e,o),collectionGuaranteesList:r.Message.toObjectList(t.getCollectionGuaranteesList(),a.CollectionGuarantee.toObject,e),blockSealsList:r.Message.toObjectList(t.getBlockSealsList(),g.BlockSeal.toObject,e),signaturesList:t.getSignaturesList_asB64()};return e&&(s.$jspbMessageInstance=t),s}),proto.flow.entities.Block.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.entities.Block;return proto.flow.entities.Block.deserializeBinaryFromReader(o,t)},proto.flow.entities.Block.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setId(o);break;case 2:o=t.readBytes();e.setParentId(o);break;case 3:o=t.readUint64();e.setHeight(o);break;case 4:o=new i.Timestamp;t.readMessage(o,i.Timestamp.deserializeBinaryFromReader),e.setTimestamp(o);break;case 5:o=new a.CollectionGuarantee;t.readMessage(o,a.CollectionGuarantee.deserializeBinaryFromReader),e.addCollectionGuarantees(o);break;case 6:o=new g.BlockSeal;t.readMessage(o,g.BlockSeal.deserializeBinaryFromReader),e.addBlockSeals(o);break;case 7:o=t.readBytes();e.addSignatures(o);break;default:t.skipField();}}return e},proto.flow.entities.Block.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.entities.Block.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.entities.Block.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getId_asU8()).length>0&&t.writeBytes(1,o),(o=e.getParentId_asU8()).length>0&&t.writeBytes(2,o),0!==(o=e.getHeight())&&t.writeUint64(3,o),null!=(o=e.getTimestamp())&&t.writeMessage(4,o,i.Timestamp.serializeBinaryToWriter),(o=e.getCollectionGuaranteesList()).length>0&&t.writeRepeatedMessage(5,o,a.CollectionGuarantee.serializeBinaryToWriter),(o=e.getBlockSealsList()).length>0&&t.writeRepeatedMessage(6,o,g.BlockSeal.serializeBinaryToWriter),(o=e.getSignaturesList_asU8()).length>0&&t.writeRepeatedBytes(7,o);},proto.flow.entities.Block.prototype.getId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.entities.Block.prototype.getId_asB64=function(){return r.Message.bytesAsB64(this.getId())},proto.flow.entities.Block.prototype.getId_asU8=function(){return r.Message.bytesAsU8(this.getId())},proto.flow.entities.Block.prototype.setId=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.entities.Block.prototype.getParentId=function(){return r.Message.getFieldWithDefault(this,2,"")},proto.flow.entities.Block.prototype.getParentId_asB64=function(){return r.Message.bytesAsB64(this.getParentId())},proto.flow.entities.Block.prototype.getParentId_asU8=function(){return r.Message.bytesAsU8(this.getParentId())},proto.flow.entities.Block.prototype.setParentId=function(e){return r.Message.setProto3BytesField(this,2,e)},proto.flow.entities.Block.prototype.getHeight=function(){return r.Message.getFieldWithDefault(this,3,0)},proto.flow.entities.Block.prototype.setHeight=function(e){return r.Message.setProto3IntField(this,3,e)},proto.flow.entities.Block.prototype.getTimestamp=function(){return r.Message.getWrapperField(this,i.Timestamp,4)},proto.flow.entities.Block.prototype.setTimestamp=function(e){return r.Message.setWrapperField(this,4,e)},proto.flow.entities.Block.prototype.clearTimestamp=function(){return this.setTimestamp(void 0)},proto.flow.entities.Block.prototype.hasTimestamp=function(){return null!=r.Message.getField(this,4)},proto.flow.entities.Block.prototype.getCollectionGuaranteesList=function(){return r.Message.getRepeatedWrapperField(this,a.CollectionGuarantee,5)},proto.flow.entities.Block.prototype.setCollectionGuaranteesList=function(e){return r.Message.setRepeatedWrapperField(this,5,e)},proto.flow.entities.Block.prototype.addCollectionGuarantees=function(e,t){return r.Message.addToRepeatedWrapperField(this,5,e,proto.flow.entities.CollectionGuarantee,t)},proto.flow.entities.Block.prototype.clearCollectionGuaranteesList=function(){return this.setCollectionGuaranteesList([])},proto.flow.entities.Block.prototype.getBlockSealsList=function(){return r.Message.getRepeatedWrapperField(this,g.BlockSeal,6)},proto.flow.entities.Block.prototype.setBlockSealsList=function(e){return r.Message.setRepeatedWrapperField(this,6,e)},proto.flow.entities.Block.prototype.addBlockSeals=function(e,t){return r.Message.addToRepeatedWrapperField(this,6,e,proto.flow.entities.BlockSeal,t)},proto.flow.entities.Block.prototype.clearBlockSealsList=function(){return this.setBlockSealsList([])},proto.flow.entities.Block.prototype.getSignaturesList=function(){return r.Message.getRepeatedField(this,7)},proto.flow.entities.Block.prototype.getSignaturesList_asB64=function(){return r.Message.bytesListAsB64(this.getSignaturesList())},proto.flow.entities.Block.prototype.getSignaturesList_asU8=function(){return r.Message.bytesListAsU8(this.getSignaturesList())},proto.flow.entities.Block.prototype.setSignaturesList=function(e){return r.Message.setField(this,7,e||[])},proto.flow.entities.Block.prototype.addSignatures=function(e,t){return r.Message.addToRepeatedField(this,7,e,t)},proto.flow.entities.Block.prototype.clearSignaturesList=function(){return this.setSignaturesList([])},s.object.extend(t,proto.flow.entities);},function(e,t,o){var r=o(0),s=r,n=Function("return this")();s.exportSymbol("proto.flow.entities.BlockSeal",null,n),proto.flow.entities.BlockSeal=function(e){r.Message.initialize(this,e,0,-1,proto.flow.entities.BlockSeal.repeatedFields_,null);},s.inherits(proto.flow.entities.BlockSeal,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.entities.BlockSeal.displayName="proto.flow.entities.BlockSeal"),proto.flow.entities.BlockSeal.repeatedFields_=[3,4],r.Message.GENERATE_TO_OBJECT&&(proto.flow.entities.BlockSeal.prototype.toObject=function(e){return proto.flow.entities.BlockSeal.toObject(e,this)},proto.flow.entities.BlockSeal.toObject=function(e,t){var o={blockId:t.getBlockId_asB64(),executionReceiptId:t.getExecutionReceiptId_asB64(),executionReceiptSignaturesList:t.getExecutionReceiptSignaturesList_asB64(),resultApprovalSignaturesList:t.getResultApprovalSignaturesList_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.entities.BlockSeal.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.entities.BlockSeal;return proto.flow.entities.BlockSeal.deserializeBinaryFromReader(o,t)},proto.flow.entities.BlockSeal.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setBlockId(o);break;case 2:o=t.readBytes();e.setExecutionReceiptId(o);break;case 3:o=t.readBytes();e.addExecutionReceiptSignatures(o);break;case 4:o=t.readBytes();e.addResultApprovalSignatures(o);break;default:t.skipField();}}return e},proto.flow.entities.BlockSeal.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.entities.BlockSeal.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.entities.BlockSeal.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getBlockId_asU8()).length>0&&t.writeBytes(1,o),(o=e.getExecutionReceiptId_asU8()).length>0&&t.writeBytes(2,o),(o=e.getExecutionReceiptSignaturesList_asU8()).length>0&&t.writeRepeatedBytes(3,o),(o=e.getResultApprovalSignaturesList_asU8()).length>0&&t.writeRepeatedBytes(4,o);},proto.flow.entities.BlockSeal.prototype.getBlockId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.entities.BlockSeal.prototype.getBlockId_asB64=function(){return r.Message.bytesAsB64(this.getBlockId())},proto.flow.entities.BlockSeal.prototype.getBlockId_asU8=function(){return r.Message.bytesAsU8(this.getBlockId())},proto.flow.entities.BlockSeal.prototype.setBlockId=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.entities.BlockSeal.prototype.getExecutionReceiptId=function(){return r.Message.getFieldWithDefault(this,2,"")},proto.flow.entities.BlockSeal.prototype.getExecutionReceiptId_asB64=function(){return r.Message.bytesAsB64(this.getExecutionReceiptId())},proto.flow.entities.BlockSeal.prototype.getExecutionReceiptId_asU8=function(){return r.Message.bytesAsU8(this.getExecutionReceiptId())},proto.flow.entities.BlockSeal.prototype.setExecutionReceiptId=function(e){return r.Message.setProto3BytesField(this,2,e)},proto.flow.entities.BlockSeal.prototype.getExecutionReceiptSignaturesList=function(){return r.Message.getRepeatedField(this,3)},proto.flow.entities.BlockSeal.prototype.getExecutionReceiptSignaturesList_asB64=function(){return r.Message.bytesListAsB64(this.getExecutionReceiptSignaturesList())},proto.flow.entities.BlockSeal.prototype.getExecutionReceiptSignaturesList_asU8=function(){return r.Message.bytesListAsU8(this.getExecutionReceiptSignaturesList())},proto.flow.entities.BlockSeal.prototype.setExecutionReceiptSignaturesList=function(e){return r.Message.setField(this,3,e||[])},proto.flow.entities.BlockSeal.prototype.addExecutionReceiptSignatures=function(e,t){return r.Message.addToRepeatedField(this,3,e,t)},proto.flow.entities.BlockSeal.prototype.clearExecutionReceiptSignaturesList=function(){return this.setExecutionReceiptSignaturesList([])},proto.flow.entities.BlockSeal.prototype.getResultApprovalSignaturesList=function(){return r.Message.getRepeatedField(this,4)},proto.flow.entities.BlockSeal.prototype.getResultApprovalSignaturesList_asB64=function(){return r.Message.bytesListAsB64(this.getResultApprovalSignaturesList())},proto.flow.entities.BlockSeal.prototype.getResultApprovalSignaturesList_asU8=function(){return r.Message.bytesListAsU8(this.getResultApprovalSignaturesList())},proto.flow.entities.BlockSeal.prototype.setResultApprovalSignaturesList=function(e){return r.Message.setField(this,4,e||[])},proto.flow.entities.BlockSeal.prototype.addResultApprovalSignatures=function(e,t){return r.Message.addToRepeatedField(this,4,e,t)},proto.flow.entities.BlockSeal.prototype.clearResultApprovalSignaturesList=function(){return this.setResultApprovalSignaturesList([])},s.object.extend(t,proto.flow.entities);},function(e,t,o){var r=o(0),s=r,n=Function("return this")();s.exportSymbol("proto.flow.entities.Transaction",null,n),s.exportSymbol("proto.flow.entities.Transaction.ProposalKey",null,n),s.exportSymbol("proto.flow.entities.Transaction.Signature",null,n),s.exportSymbol("proto.flow.entities.TransactionStatus",null,n),proto.flow.entities.Transaction=function(e){r.Message.initialize(this,e,0,-1,proto.flow.entities.Transaction.repeatedFields_,null);},s.inherits(proto.flow.entities.Transaction,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.entities.Transaction.displayName="proto.flow.entities.Transaction"),proto.flow.entities.Transaction.ProposalKey=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.entities.Transaction.ProposalKey,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.entities.Transaction.ProposalKey.displayName="proto.flow.entities.Transaction.ProposalKey"),proto.flow.entities.Transaction.Signature=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.entities.Transaction.Signature,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.entities.Transaction.Signature.displayName="proto.flow.entities.Transaction.Signature"),proto.flow.entities.Transaction.repeatedFields_=[2,7,8,9],r.Message.GENERATE_TO_OBJECT&&(proto.flow.entities.Transaction.prototype.toObject=function(e){return proto.flow.entities.Transaction.toObject(e,this)},proto.flow.entities.Transaction.toObject=function(e,t){var o,s={script:t.getScript_asB64(),argumentsList:t.getArgumentsList_asB64(),referenceBlockId:t.getReferenceBlockId_asB64(),gasLimit:r.Message.getFieldWithDefault(t,4,0),proposalKey:(o=t.getProposalKey())&&proto.flow.entities.Transaction.ProposalKey.toObject(e,o),payer:t.getPayer_asB64(),authorizersList:t.getAuthorizersList_asB64(),payloadSignaturesList:r.Message.toObjectList(t.getPayloadSignaturesList(),proto.flow.entities.Transaction.Signature.toObject,e),envelopeSignaturesList:r.Message.toObjectList(t.getEnvelopeSignaturesList(),proto.flow.entities.Transaction.Signature.toObject,e)};return e&&(s.$jspbMessageInstance=t),s}),proto.flow.entities.Transaction.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.entities.Transaction;return proto.flow.entities.Transaction.deserializeBinaryFromReader(o,t)},proto.flow.entities.Transaction.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setScript(o);break;case 2:o=t.readBytes();e.addArguments(o);break;case 3:o=t.readBytes();e.setReferenceBlockId(o);break;case 4:o=t.readUint64();e.setGasLimit(o);break;case 5:o=new proto.flow.entities.Transaction.ProposalKey;t.readMessage(o,proto.flow.entities.Transaction.ProposalKey.deserializeBinaryFromReader),e.setProposalKey(o);break;case 6:o=t.readBytes();e.setPayer(o);break;case 7:o=t.readBytes();e.addAuthorizers(o);break;case 8:o=new proto.flow.entities.Transaction.Signature;t.readMessage(o,proto.flow.entities.Transaction.Signature.deserializeBinaryFromReader),e.addPayloadSignatures(o);break;case 9:o=new proto.flow.entities.Transaction.Signature;t.readMessage(o,proto.flow.entities.Transaction.Signature.deserializeBinaryFromReader),e.addEnvelopeSignatures(o);break;default:t.skipField();}}return e},proto.flow.entities.Transaction.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.entities.Transaction.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.entities.Transaction.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getScript_asU8()).length>0&&t.writeBytes(1,o),(o=e.getArgumentsList_asU8()).length>0&&t.writeRepeatedBytes(2,o),(o=e.getReferenceBlockId_asU8()).length>0&&t.writeBytes(3,o),0!==(o=e.getGasLimit())&&t.writeUint64(4,o),null!=(o=e.getProposalKey())&&t.writeMessage(5,o,proto.flow.entities.Transaction.ProposalKey.serializeBinaryToWriter),(o=e.getPayer_asU8()).length>0&&t.writeBytes(6,o),(o=e.getAuthorizersList_asU8()).length>0&&t.writeRepeatedBytes(7,o),(o=e.getPayloadSignaturesList()).length>0&&t.writeRepeatedMessage(8,o,proto.flow.entities.Transaction.Signature.serializeBinaryToWriter),(o=e.getEnvelopeSignaturesList()).length>0&&t.writeRepeatedMessage(9,o,proto.flow.entities.Transaction.Signature.serializeBinaryToWriter);},r.Message.GENERATE_TO_OBJECT&&(proto.flow.entities.Transaction.ProposalKey.prototype.toObject=function(e){return proto.flow.entities.Transaction.ProposalKey.toObject(e,this)},proto.flow.entities.Transaction.ProposalKey.toObject=function(e,t){var o={address:t.getAddress_asB64(),keyId:r.Message.getFieldWithDefault(t,2,0),sequenceNumber:r.Message.getFieldWithDefault(t,3,0)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.entities.Transaction.ProposalKey.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.entities.Transaction.ProposalKey;return proto.flow.entities.Transaction.ProposalKey.deserializeBinaryFromReader(o,t)},proto.flow.entities.Transaction.ProposalKey.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setAddress(o);break;case 2:o=t.readUint32();e.setKeyId(o);break;case 3:o=t.readUint64();e.setSequenceNumber(o);break;default:t.skipField();}}return e},proto.flow.entities.Transaction.ProposalKey.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.entities.Transaction.ProposalKey.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.entities.Transaction.ProposalKey.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getAddress_asU8()).length>0&&t.writeBytes(1,o),0!==(o=e.getKeyId())&&t.writeUint32(2,o),0!==(o=e.getSequenceNumber())&&t.writeUint64(3,o);},proto.flow.entities.Transaction.ProposalKey.prototype.getAddress=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.entities.Transaction.ProposalKey.prototype.getAddress_asB64=function(){return r.Message.bytesAsB64(this.getAddress())},proto.flow.entities.Transaction.ProposalKey.prototype.getAddress_asU8=function(){return r.Message.bytesAsU8(this.getAddress())},proto.flow.entities.Transaction.ProposalKey.prototype.setAddress=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.entities.Transaction.ProposalKey.prototype.getKeyId=function(){return r.Message.getFieldWithDefault(this,2,0)},proto.flow.entities.Transaction.ProposalKey.prototype.setKeyId=function(e){return r.Message.setProto3IntField(this,2,e)},proto.flow.entities.Transaction.ProposalKey.prototype.getSequenceNumber=function(){return r.Message.getFieldWithDefault(this,3,0)},proto.flow.entities.Transaction.ProposalKey.prototype.setSequenceNumber=function(e){return r.Message.setProto3IntField(this,3,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.entities.Transaction.Signature.prototype.toObject=function(e){return proto.flow.entities.Transaction.Signature.toObject(e,this)},proto.flow.entities.Transaction.Signature.toObject=function(e,t){var o={address:t.getAddress_asB64(),keyId:r.Message.getFieldWithDefault(t,2,0),signature:t.getSignature_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.entities.Transaction.Signature.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.entities.Transaction.Signature;return proto.flow.entities.Transaction.Signature.deserializeBinaryFromReader(o,t)},proto.flow.entities.Transaction.Signature.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setAddress(o);break;case 2:o=t.readUint32();e.setKeyId(o);break;case 3:o=t.readBytes();e.setSignature(o);break;default:t.skipField();}}return e},proto.flow.entities.Transaction.Signature.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.entities.Transaction.Signature.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.entities.Transaction.Signature.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getAddress_asU8()).length>0&&t.writeBytes(1,o),0!==(o=e.getKeyId())&&t.writeUint32(2,o),(o=e.getSignature_asU8()).length>0&&t.writeBytes(3,o);},proto.flow.entities.Transaction.Signature.prototype.getAddress=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.entities.Transaction.Signature.prototype.getAddress_asB64=function(){return r.Message.bytesAsB64(this.getAddress())},proto.flow.entities.Transaction.Signature.prototype.getAddress_asU8=function(){return r.Message.bytesAsU8(this.getAddress())},proto.flow.entities.Transaction.Signature.prototype.setAddress=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.entities.Transaction.Signature.prototype.getKeyId=function(){return r.Message.getFieldWithDefault(this,2,0)},proto.flow.entities.Transaction.Signature.prototype.setKeyId=function(e){return r.Message.setProto3IntField(this,2,e)},proto.flow.entities.Transaction.Signature.prototype.getSignature=function(){return r.Message.getFieldWithDefault(this,3,"")},proto.flow.entities.Transaction.Signature.prototype.getSignature_asB64=function(){return r.Message.bytesAsB64(this.getSignature())},proto.flow.entities.Transaction.Signature.prototype.getSignature_asU8=function(){return r.Message.bytesAsU8(this.getSignature())},proto.flow.entities.Transaction.Signature.prototype.setSignature=function(e){return r.Message.setProto3BytesField(this,3,e)},proto.flow.entities.Transaction.prototype.getScript=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.entities.Transaction.prototype.getScript_asB64=function(){return r.Message.bytesAsB64(this.getScript())},proto.flow.entities.Transaction.prototype.getScript_asU8=function(){return r.Message.bytesAsU8(this.getScript())},proto.flow.entities.Transaction.prototype.setScript=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.entities.Transaction.prototype.getArgumentsList=function(){return r.Message.getRepeatedField(this,2)},proto.flow.entities.Transaction.prototype.getArgumentsList_asB64=function(){return r.Message.bytesListAsB64(this.getArgumentsList())},proto.flow.entities.Transaction.prototype.getArgumentsList_asU8=function(){return r.Message.bytesListAsU8(this.getArgumentsList())},proto.flow.entities.Transaction.prototype.setArgumentsList=function(e){return r.Message.setField(this,2,e||[])},proto.flow.entities.Transaction.prototype.addArguments=function(e,t){return r.Message.addToRepeatedField(this,2,e,t)},proto.flow.entities.Transaction.prototype.clearArgumentsList=function(){return this.setArgumentsList([])},proto.flow.entities.Transaction.prototype.getReferenceBlockId=function(){return r.Message.getFieldWithDefault(this,3,"")},proto.flow.entities.Transaction.prototype.getReferenceBlockId_asB64=function(){return r.Message.bytesAsB64(this.getReferenceBlockId())},proto.flow.entities.Transaction.prototype.getReferenceBlockId_asU8=function(){return r.Message.bytesAsU8(this.getReferenceBlockId())},proto.flow.entities.Transaction.prototype.setReferenceBlockId=function(e){return r.Message.setProto3BytesField(this,3,e)},proto.flow.entities.Transaction.prototype.getGasLimit=function(){return r.Message.getFieldWithDefault(this,4,0)},proto.flow.entities.Transaction.prototype.setGasLimit=function(e){return r.Message.setProto3IntField(this,4,e)},proto.flow.entities.Transaction.prototype.getProposalKey=function(){return r.Message.getWrapperField(this,proto.flow.entities.Transaction.ProposalKey,5)},proto.flow.entities.Transaction.prototype.setProposalKey=function(e){return r.Message.setWrapperField(this,5,e)},proto.flow.entities.Transaction.prototype.clearProposalKey=function(){return this.setProposalKey(void 0)},proto.flow.entities.Transaction.prototype.hasProposalKey=function(){return null!=r.Message.getField(this,5)},proto.flow.entities.Transaction.prototype.getPayer=function(){return r.Message.getFieldWithDefault(this,6,"")},proto.flow.entities.Transaction.prototype.getPayer_asB64=function(){return r.Message.bytesAsB64(this.getPayer())},proto.flow.entities.Transaction.prototype.getPayer_asU8=function(){return r.Message.bytesAsU8(this.getPayer())},proto.flow.entities.Transaction.prototype.setPayer=function(e){return r.Message.setProto3BytesField(this,6,e)},proto.flow.entities.Transaction.prototype.getAuthorizersList=function(){return r.Message.getRepeatedField(this,7)},proto.flow.entities.Transaction.prototype.getAuthorizersList_asB64=function(){return r.Message.bytesListAsB64(this.getAuthorizersList())},proto.flow.entities.Transaction.prototype.getAuthorizersList_asU8=function(){return r.Message.bytesListAsU8(this.getAuthorizersList())},proto.flow.entities.Transaction.prototype.setAuthorizersList=function(e){return r.Message.setField(this,7,e||[])},proto.flow.entities.Transaction.prototype.addAuthorizers=function(e,t){return r.Message.addToRepeatedField(this,7,e,t)},proto.flow.entities.Transaction.prototype.clearAuthorizersList=function(){return this.setAuthorizersList([])},proto.flow.entities.Transaction.prototype.getPayloadSignaturesList=function(){return r.Message.getRepeatedWrapperField(this,proto.flow.entities.Transaction.Signature,8)},proto.flow.entities.Transaction.prototype.setPayloadSignaturesList=function(e){return r.Message.setRepeatedWrapperField(this,8,e)},proto.flow.entities.Transaction.prototype.addPayloadSignatures=function(e,t){return r.Message.addToRepeatedWrapperField(this,8,e,proto.flow.entities.Transaction.Signature,t)},proto.flow.entities.Transaction.prototype.clearPayloadSignaturesList=function(){return this.setPayloadSignaturesList([])},proto.flow.entities.Transaction.prototype.getEnvelopeSignaturesList=function(){return r.Message.getRepeatedWrapperField(this,proto.flow.entities.Transaction.Signature,9)},proto.flow.entities.Transaction.prototype.setEnvelopeSignaturesList=function(e){return r.Message.setRepeatedWrapperField(this,9,e)},proto.flow.entities.Transaction.prototype.addEnvelopeSignatures=function(e,t){return r.Message.addToRepeatedWrapperField(this,9,e,proto.flow.entities.Transaction.Signature,t)},proto.flow.entities.Transaction.prototype.clearEnvelopeSignaturesList=function(){return this.setEnvelopeSignaturesList([])},proto.flow.entities.TransactionStatus={UNKNOWN:0,PENDING:1,FINALIZED:2,EXECUTED:3,SEALED:4,EXPIRED:5},s.object.extend(t,proto.flow.entities);},function(e,t,o){var r=o(0),s=r,n=Function("return this")(),i=o(1);s.object.extend(proto,i);var a=o(3);s.object.extend(proto,a),s.exportSymbol("proto.flow.execution.ExecuteScriptAtBlockIDRequest",null,n),s.exportSymbol("proto.flow.execution.ExecuteScriptAtBlockIDResponse",null,n),s.exportSymbol("proto.flow.execution.GetAccountAtBlockIDRequest",null,n),s.exportSymbol("proto.flow.execution.GetAccountAtBlockIDResponse",null,n),s.exportSymbol("proto.flow.execution.GetEventsForBlockIDsRequest",null,n),s.exportSymbol("proto.flow.execution.GetEventsForBlockIDsResponse",null,n),s.exportSymbol("proto.flow.execution.GetEventsForBlockIDsResponse.Result",null,n),s.exportSymbol("proto.flow.execution.GetTransactionResultRequest",null,n),s.exportSymbol("proto.flow.execution.GetTransactionResultResponse",null,n),s.exportSymbol("proto.flow.execution.PingRequest",null,n),s.exportSymbol("proto.flow.execution.PingResponse",null,n),proto.flow.execution.PingRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.execution.PingRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.execution.PingRequest.displayName="proto.flow.execution.PingRequest"),proto.flow.execution.PingResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.execution.PingResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.execution.PingResponse.displayName="proto.flow.execution.PingResponse"),proto.flow.execution.GetAccountAtBlockIDRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.execution.GetAccountAtBlockIDRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.execution.GetAccountAtBlockIDRequest.displayName="proto.flow.execution.GetAccountAtBlockIDRequest"),proto.flow.execution.GetAccountAtBlockIDResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.execution.GetAccountAtBlockIDResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.execution.GetAccountAtBlockIDResponse.displayName="proto.flow.execution.GetAccountAtBlockIDResponse"),proto.flow.execution.ExecuteScriptAtBlockIDRequest=function(e){r.Message.initialize(this,e,0,-1,proto.flow.execution.ExecuteScriptAtBlockIDRequest.repeatedFields_,null);},s.inherits(proto.flow.execution.ExecuteScriptAtBlockIDRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.execution.ExecuteScriptAtBlockIDRequest.displayName="proto.flow.execution.ExecuteScriptAtBlockIDRequest"),proto.flow.execution.ExecuteScriptAtBlockIDResponse=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.execution.ExecuteScriptAtBlockIDResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.execution.ExecuteScriptAtBlockIDResponse.displayName="proto.flow.execution.ExecuteScriptAtBlockIDResponse"),proto.flow.execution.GetEventsForBlockIDsResponse=function(e){r.Message.initialize(this,e,0,-1,proto.flow.execution.GetEventsForBlockIDsResponse.repeatedFields_,null);},s.inherits(proto.flow.execution.GetEventsForBlockIDsResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.execution.GetEventsForBlockIDsResponse.displayName="proto.flow.execution.GetEventsForBlockIDsResponse"),proto.flow.execution.GetEventsForBlockIDsResponse.Result=function(e){r.Message.initialize(this,e,0,-1,proto.flow.execution.GetEventsForBlockIDsResponse.Result.repeatedFields_,null);},s.inherits(proto.flow.execution.GetEventsForBlockIDsResponse.Result,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.execution.GetEventsForBlockIDsResponse.Result.displayName="proto.flow.execution.GetEventsForBlockIDsResponse.Result"),proto.flow.execution.GetEventsForBlockIDsRequest=function(e){r.Message.initialize(this,e,0,-1,proto.flow.execution.GetEventsForBlockIDsRequest.repeatedFields_,null);},s.inherits(proto.flow.execution.GetEventsForBlockIDsRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.execution.GetEventsForBlockIDsRequest.displayName="proto.flow.execution.GetEventsForBlockIDsRequest"),proto.flow.execution.GetTransactionResultRequest=function(e){r.Message.initialize(this,e,0,-1,null,null);},s.inherits(proto.flow.execution.GetTransactionResultRequest,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.execution.GetTransactionResultRequest.displayName="proto.flow.execution.GetTransactionResultRequest"),proto.flow.execution.GetTransactionResultResponse=function(e){r.Message.initialize(this,e,0,-1,proto.flow.execution.GetTransactionResultResponse.repeatedFields_,null);},s.inherits(proto.flow.execution.GetTransactionResultResponse,r.Message),s.DEBUG&&!COMPILED&&(proto.flow.execution.GetTransactionResultResponse.displayName="proto.flow.execution.GetTransactionResultResponse"),r.Message.GENERATE_TO_OBJECT&&(proto.flow.execution.PingRequest.prototype.toObject=function(e){return proto.flow.execution.PingRequest.toObject(e,this)},proto.flow.execution.PingRequest.toObject=function(e,t){var o={};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.execution.PingRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.execution.PingRequest;return proto.flow.execution.PingRequest.deserializeBinaryFromReader(o,t)},proto.flow.execution.PingRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){t.getFieldNumber();t.skipField();}return e},proto.flow.execution.PingRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.execution.PingRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.execution.PingRequest.serializeBinaryToWriter=function(e,t){},r.Message.GENERATE_TO_OBJECT&&(proto.flow.execution.PingResponse.prototype.toObject=function(e){return proto.flow.execution.PingResponse.toObject(e,this)},proto.flow.execution.PingResponse.toObject=function(e,t){var o={};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.execution.PingResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.execution.PingResponse;return proto.flow.execution.PingResponse.deserializeBinaryFromReader(o,t)},proto.flow.execution.PingResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){t.getFieldNumber();t.skipField();}return e},proto.flow.execution.PingResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.execution.PingResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.execution.PingResponse.serializeBinaryToWriter=function(e,t){},r.Message.GENERATE_TO_OBJECT&&(proto.flow.execution.GetAccountAtBlockIDRequest.prototype.toObject=function(e){return proto.flow.execution.GetAccountAtBlockIDRequest.toObject(e,this)},proto.flow.execution.GetAccountAtBlockIDRequest.toObject=function(e,t){var o={blockId:t.getBlockId_asB64(),address:t.getAddress_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.execution.GetAccountAtBlockIDRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.execution.GetAccountAtBlockIDRequest;return proto.flow.execution.GetAccountAtBlockIDRequest.deserializeBinaryFromReader(o,t)},proto.flow.execution.GetAccountAtBlockIDRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setBlockId(o);break;case 2:o=t.readBytes();e.setAddress(o);break;default:t.skipField();}}return e},proto.flow.execution.GetAccountAtBlockIDRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.execution.GetAccountAtBlockIDRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.execution.GetAccountAtBlockIDRequest.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getBlockId_asU8()).length>0&&t.writeBytes(1,o),(o=e.getAddress_asU8()).length>0&&t.writeBytes(2,o);},proto.flow.execution.GetAccountAtBlockIDRequest.prototype.getBlockId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.execution.GetAccountAtBlockIDRequest.prototype.getBlockId_asB64=function(){return r.Message.bytesAsB64(this.getBlockId())},proto.flow.execution.GetAccountAtBlockIDRequest.prototype.getBlockId_asU8=function(){return r.Message.bytesAsU8(this.getBlockId())},proto.flow.execution.GetAccountAtBlockIDRequest.prototype.setBlockId=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.execution.GetAccountAtBlockIDRequest.prototype.getAddress=function(){return r.Message.getFieldWithDefault(this,2,"")},proto.flow.execution.GetAccountAtBlockIDRequest.prototype.getAddress_asB64=function(){return r.Message.bytesAsB64(this.getAddress())},proto.flow.execution.GetAccountAtBlockIDRequest.prototype.getAddress_asU8=function(){return r.Message.bytesAsU8(this.getAddress())},proto.flow.execution.GetAccountAtBlockIDRequest.prototype.setAddress=function(e){return r.Message.setProto3BytesField(this,2,e)},r.Message.GENERATE_TO_OBJECT&&(proto.flow.execution.GetAccountAtBlockIDResponse.prototype.toObject=function(e){return proto.flow.execution.GetAccountAtBlockIDResponse.toObject(e,this)},proto.flow.execution.GetAccountAtBlockIDResponse.toObject=function(e,t){var o,r={account:(o=t.getAccount())&&i.Account.toObject(e,o)};return e&&(r.$jspbMessageInstance=t),r}),proto.flow.execution.GetAccountAtBlockIDResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.execution.GetAccountAtBlockIDResponse;return proto.flow.execution.GetAccountAtBlockIDResponse.deserializeBinaryFromReader(o,t)},proto.flow.execution.GetAccountAtBlockIDResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=new i.Account;t.readMessage(o,i.Account.deserializeBinaryFromReader),e.setAccount(o);break;default:t.skipField();}}return e},proto.flow.execution.GetAccountAtBlockIDResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.execution.GetAccountAtBlockIDResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.execution.GetAccountAtBlockIDResponse.serializeBinaryToWriter=function(e,t){var o;null!=(o=e.getAccount())&&t.writeMessage(1,o,i.Account.serializeBinaryToWriter);},proto.flow.execution.GetAccountAtBlockIDResponse.prototype.getAccount=function(){return r.Message.getWrapperField(this,i.Account,1)},proto.flow.execution.GetAccountAtBlockIDResponse.prototype.setAccount=function(e){return r.Message.setWrapperField(this,1,e)},proto.flow.execution.GetAccountAtBlockIDResponse.prototype.clearAccount=function(){return this.setAccount(void 0)},proto.flow.execution.GetAccountAtBlockIDResponse.prototype.hasAccount=function(){return null!=r.Message.getField(this,1)},proto.flow.execution.ExecuteScriptAtBlockIDRequest.repeatedFields_=[3],r.Message.GENERATE_TO_OBJECT&&(proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.toObject=function(e){return proto.flow.execution.ExecuteScriptAtBlockIDRequest.toObject(e,this)},proto.flow.execution.ExecuteScriptAtBlockIDRequest.toObject=function(e,t){var o={blockId:t.getBlockId_asB64(),script:t.getScript_asB64(),argumentsList:t.getArgumentsList_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.execution.ExecuteScriptAtBlockIDRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.execution.ExecuteScriptAtBlockIDRequest;return proto.flow.execution.ExecuteScriptAtBlockIDRequest.deserializeBinaryFromReader(o,t)},proto.flow.execution.ExecuteScriptAtBlockIDRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setBlockId(o);break;case 2:o=t.readBytes();e.setScript(o);break;case 3:o=t.readBytes();e.addArguments(o);break;default:t.skipField();}}return e},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.execution.ExecuteScriptAtBlockIDRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.execution.ExecuteScriptAtBlockIDRequest.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getBlockId_asU8()).length>0&&t.writeBytes(1,o),(o=e.getScript_asU8()).length>0&&t.writeBytes(2,o),(o=e.getArgumentsList_asU8()).length>0&&t.writeRepeatedBytes(3,o);},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.getBlockId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.getBlockId_asB64=function(){return r.Message.bytesAsB64(this.getBlockId())},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.getBlockId_asU8=function(){return r.Message.bytesAsU8(this.getBlockId())},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.setBlockId=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.getScript=function(){return r.Message.getFieldWithDefault(this,2,"")},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.getScript_asB64=function(){return r.Message.bytesAsB64(this.getScript())},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.getScript_asU8=function(){return r.Message.bytesAsU8(this.getScript())},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.setScript=function(e){return r.Message.setProto3BytesField(this,2,e)},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.getArgumentsList=function(){return r.Message.getRepeatedField(this,3)},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.getArgumentsList_asB64=function(){return r.Message.bytesListAsB64(this.getArgumentsList())},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.getArgumentsList_asU8=function(){return r.Message.bytesListAsU8(this.getArgumentsList())},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.setArgumentsList=function(e){return r.Message.setField(this,3,e||[])},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.addArguments=function(e,t){return r.Message.addToRepeatedField(this,3,e,t)},proto.flow.execution.ExecuteScriptAtBlockIDRequest.prototype.clearArgumentsList=function(){return this.setArgumentsList([])},r.Message.GENERATE_TO_OBJECT&&(proto.flow.execution.ExecuteScriptAtBlockIDResponse.prototype.toObject=function(e){return proto.flow.execution.ExecuteScriptAtBlockIDResponse.toObject(e,this)},proto.flow.execution.ExecuteScriptAtBlockIDResponse.toObject=function(e,t){var o={value:t.getValue_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.execution.ExecuteScriptAtBlockIDResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.execution.ExecuteScriptAtBlockIDResponse;return proto.flow.execution.ExecuteScriptAtBlockIDResponse.deserializeBinaryFromReader(o,t)},proto.flow.execution.ExecuteScriptAtBlockIDResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setValue(o);break;default:t.skipField();}}return e},proto.flow.execution.ExecuteScriptAtBlockIDResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.execution.ExecuteScriptAtBlockIDResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.execution.ExecuteScriptAtBlockIDResponse.serializeBinaryToWriter=function(e,t){var o;(o=e.getValue_asU8()).length>0&&t.writeBytes(1,o);},proto.flow.execution.ExecuteScriptAtBlockIDResponse.prototype.getValue=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.execution.ExecuteScriptAtBlockIDResponse.prototype.getValue_asB64=function(){return r.Message.bytesAsB64(this.getValue())},proto.flow.execution.ExecuteScriptAtBlockIDResponse.prototype.getValue_asU8=function(){return r.Message.bytesAsU8(this.getValue())},proto.flow.execution.ExecuteScriptAtBlockIDResponse.prototype.setValue=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.execution.GetEventsForBlockIDsResponse.repeatedFields_=[1],r.Message.GENERATE_TO_OBJECT&&(proto.flow.execution.GetEventsForBlockIDsResponse.prototype.toObject=function(e){return proto.flow.execution.GetEventsForBlockIDsResponse.toObject(e,this)},proto.flow.execution.GetEventsForBlockIDsResponse.toObject=function(e,t){var o={resultsList:r.Message.toObjectList(t.getResultsList(),proto.flow.execution.GetEventsForBlockIDsResponse.Result.toObject,e)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.execution.GetEventsForBlockIDsResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.execution.GetEventsForBlockIDsResponse;return proto.flow.execution.GetEventsForBlockIDsResponse.deserializeBinaryFromReader(o,t)},proto.flow.execution.GetEventsForBlockIDsResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=new proto.flow.execution.GetEventsForBlockIDsResponse.Result;t.readMessage(o,proto.flow.execution.GetEventsForBlockIDsResponse.Result.deserializeBinaryFromReader),e.addResults(o);break;default:t.skipField();}}return e},proto.flow.execution.GetEventsForBlockIDsResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.execution.GetEventsForBlockIDsResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.execution.GetEventsForBlockIDsResponse.serializeBinaryToWriter=function(e,t){var o;(o=e.getResultsList()).length>0&&t.writeRepeatedMessage(1,o,proto.flow.execution.GetEventsForBlockIDsResponse.Result.serializeBinaryToWriter);},proto.flow.execution.GetEventsForBlockIDsResponse.Result.repeatedFields_=[3],r.Message.GENERATE_TO_OBJECT&&(proto.flow.execution.GetEventsForBlockIDsResponse.Result.prototype.toObject=function(e){return proto.flow.execution.GetEventsForBlockIDsResponse.Result.toObject(e,this)},proto.flow.execution.GetEventsForBlockIDsResponse.Result.toObject=function(e,t){var o={blockId:t.getBlockId_asB64(),blockHeight:r.Message.getFieldWithDefault(t,2,0),eventsList:r.Message.toObjectList(t.getEventsList(),a.Event.toObject,e)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.execution.GetEventsForBlockIDsResponse.Result.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.execution.GetEventsForBlockIDsResponse.Result;return proto.flow.execution.GetEventsForBlockIDsResponse.Result.deserializeBinaryFromReader(o,t)},proto.flow.execution.GetEventsForBlockIDsResponse.Result.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setBlockId(o);break;case 2:o=t.readUint64();e.setBlockHeight(o);break;case 3:o=new a.Event;t.readMessage(o,a.Event.deserializeBinaryFromReader),e.addEvents(o);break;default:t.skipField();}}return e},proto.flow.execution.GetEventsForBlockIDsResponse.Result.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.execution.GetEventsForBlockIDsResponse.Result.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.execution.GetEventsForBlockIDsResponse.Result.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getBlockId_asU8()).length>0&&t.writeBytes(1,o),0!==(o=e.getBlockHeight())&&t.writeUint64(2,o),(o=e.getEventsList()).length>0&&t.writeRepeatedMessage(3,o,a.Event.serializeBinaryToWriter);},proto.flow.execution.GetEventsForBlockIDsResponse.Result.prototype.getBlockId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.execution.GetEventsForBlockIDsResponse.Result.prototype.getBlockId_asB64=function(){return r.Message.bytesAsB64(this.getBlockId())},proto.flow.execution.GetEventsForBlockIDsResponse.Result.prototype.getBlockId_asU8=function(){return r.Message.bytesAsU8(this.getBlockId())},proto.flow.execution.GetEventsForBlockIDsResponse.Result.prototype.setBlockId=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.execution.GetEventsForBlockIDsResponse.Result.prototype.getBlockHeight=function(){return r.Message.getFieldWithDefault(this,2,0)},proto.flow.execution.GetEventsForBlockIDsResponse.Result.prototype.setBlockHeight=function(e){return r.Message.setProto3IntField(this,2,e)},proto.flow.execution.GetEventsForBlockIDsResponse.Result.prototype.getEventsList=function(){return r.Message.getRepeatedWrapperField(this,a.Event,3)},proto.flow.execution.GetEventsForBlockIDsResponse.Result.prototype.setEventsList=function(e){return r.Message.setRepeatedWrapperField(this,3,e)},proto.flow.execution.GetEventsForBlockIDsResponse.Result.prototype.addEvents=function(e,t){return r.Message.addToRepeatedWrapperField(this,3,e,proto.flow.entities.Event,t)},proto.flow.execution.GetEventsForBlockIDsResponse.Result.prototype.clearEventsList=function(){return this.setEventsList([])},proto.flow.execution.GetEventsForBlockIDsResponse.prototype.getResultsList=function(){return r.Message.getRepeatedWrapperField(this,proto.flow.execution.GetEventsForBlockIDsResponse.Result,1)},proto.flow.execution.GetEventsForBlockIDsResponse.prototype.setResultsList=function(e){return r.Message.setRepeatedWrapperField(this,1,e)},proto.flow.execution.GetEventsForBlockIDsResponse.prototype.addResults=function(e,t){return r.Message.addToRepeatedWrapperField(this,1,e,proto.flow.execution.GetEventsForBlockIDsResponse.Result,t)},proto.flow.execution.GetEventsForBlockIDsResponse.prototype.clearResultsList=function(){return this.setResultsList([])},proto.flow.execution.GetEventsForBlockIDsRequest.repeatedFields_=[2],r.Message.GENERATE_TO_OBJECT&&(proto.flow.execution.GetEventsForBlockIDsRequest.prototype.toObject=function(e){return proto.flow.execution.GetEventsForBlockIDsRequest.toObject(e,this)},proto.flow.execution.GetEventsForBlockIDsRequest.toObject=function(e,t){var o={type:r.Message.getFieldWithDefault(t,1,""),blockIdsList:t.getBlockIdsList_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.execution.GetEventsForBlockIDsRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.execution.GetEventsForBlockIDsRequest;return proto.flow.execution.GetEventsForBlockIDsRequest.deserializeBinaryFromReader(o,t)},proto.flow.execution.GetEventsForBlockIDsRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readString();e.setType(o);break;case 2:o=t.readBytes();e.addBlockIds(o);break;default:t.skipField();}}return e},proto.flow.execution.GetEventsForBlockIDsRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.execution.GetEventsForBlockIDsRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.execution.GetEventsForBlockIDsRequest.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getType()).length>0&&t.writeString(1,o),(o=e.getBlockIdsList_asU8()).length>0&&t.writeRepeatedBytes(2,o);},proto.flow.execution.GetEventsForBlockIDsRequest.prototype.getType=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.execution.GetEventsForBlockIDsRequest.prototype.setType=function(e){return r.Message.setProto3StringField(this,1,e)},proto.flow.execution.GetEventsForBlockIDsRequest.prototype.getBlockIdsList=function(){return r.Message.getRepeatedField(this,2)},proto.flow.execution.GetEventsForBlockIDsRequest.prototype.getBlockIdsList_asB64=function(){return r.Message.bytesListAsB64(this.getBlockIdsList())},proto.flow.execution.GetEventsForBlockIDsRequest.prototype.getBlockIdsList_asU8=function(){return r.Message.bytesListAsU8(this.getBlockIdsList())},proto.flow.execution.GetEventsForBlockIDsRequest.prototype.setBlockIdsList=function(e){return r.Message.setField(this,2,e||[])},proto.flow.execution.GetEventsForBlockIDsRequest.prototype.addBlockIds=function(e,t){return r.Message.addToRepeatedField(this,2,e,t)},proto.flow.execution.GetEventsForBlockIDsRequest.prototype.clearBlockIdsList=function(){return this.setBlockIdsList([])},r.Message.GENERATE_TO_OBJECT&&(proto.flow.execution.GetTransactionResultRequest.prototype.toObject=function(e){return proto.flow.execution.GetTransactionResultRequest.toObject(e,this)},proto.flow.execution.GetTransactionResultRequest.toObject=function(e,t){var o={blockId:t.getBlockId_asB64(),transactionId:t.getTransactionId_asB64()};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.execution.GetTransactionResultRequest.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.execution.GetTransactionResultRequest;return proto.flow.execution.GetTransactionResultRequest.deserializeBinaryFromReader(o,t)},proto.flow.execution.GetTransactionResultRequest.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readBytes();e.setBlockId(o);break;case 2:o=t.readBytes();e.setTransactionId(o);break;default:t.skipField();}}return e},proto.flow.execution.GetTransactionResultRequest.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.execution.GetTransactionResultRequest.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.execution.GetTransactionResultRequest.serializeBinaryToWriter=function(e,t){var o=void 0;(o=e.getBlockId_asU8()).length>0&&t.writeBytes(1,o),(o=e.getTransactionId_asU8()).length>0&&t.writeBytes(2,o);},proto.flow.execution.GetTransactionResultRequest.prototype.getBlockId=function(){return r.Message.getFieldWithDefault(this,1,"")},proto.flow.execution.GetTransactionResultRequest.prototype.getBlockId_asB64=function(){return r.Message.bytesAsB64(this.getBlockId())},proto.flow.execution.GetTransactionResultRequest.prototype.getBlockId_asU8=function(){return r.Message.bytesAsU8(this.getBlockId())},proto.flow.execution.GetTransactionResultRequest.prototype.setBlockId=function(e){return r.Message.setProto3BytesField(this,1,e)},proto.flow.execution.GetTransactionResultRequest.prototype.getTransactionId=function(){return r.Message.getFieldWithDefault(this,2,"")},proto.flow.execution.GetTransactionResultRequest.prototype.getTransactionId_asB64=function(){return r.Message.bytesAsB64(this.getTransactionId())},proto.flow.execution.GetTransactionResultRequest.prototype.getTransactionId_asU8=function(){return r.Message.bytesAsU8(this.getTransactionId())},proto.flow.execution.GetTransactionResultRequest.prototype.setTransactionId=function(e){return r.Message.setProto3BytesField(this,2,e)},proto.flow.execution.GetTransactionResultResponse.repeatedFields_=[3],r.Message.GENERATE_TO_OBJECT&&(proto.flow.execution.GetTransactionResultResponse.prototype.toObject=function(e){return proto.flow.execution.GetTransactionResultResponse.toObject(e,this)},proto.flow.execution.GetTransactionResultResponse.toObject=function(e,t){var o={statusCode:r.Message.getFieldWithDefault(t,1,0),errorMessage:r.Message.getFieldWithDefault(t,2,""),eventsList:r.Message.toObjectList(t.getEventsList(),a.Event.toObject,e)};return e&&(o.$jspbMessageInstance=t),o}),proto.flow.execution.GetTransactionResultResponse.deserializeBinary=function(e){var t=new r.BinaryReader(e),o=new proto.flow.execution.GetTransactionResultResponse;return proto.flow.execution.GetTransactionResultResponse.deserializeBinaryFromReader(o,t)},proto.flow.execution.GetTransactionResultResponse.deserializeBinaryFromReader=function(e,t){for(;t.nextField()&&!t.isEndGroup();){switch(t.getFieldNumber()){case 1:var o=t.readUint32();e.setStatusCode(o);break;case 2:o=t.readString();e.setErrorMessage(o);break;case 3:o=new a.Event;t.readMessage(o,a.Event.deserializeBinaryFromReader),e.addEvents(o);break;default:t.skipField();}}return e},proto.flow.execution.GetTransactionResultResponse.prototype.serializeBinary=function(){var e=new r.BinaryWriter;return proto.flow.execution.GetTransactionResultResponse.serializeBinaryToWriter(this,e),e.getResultBuffer()},proto.flow.execution.GetTransactionResultResponse.serializeBinaryToWriter=function(e,t){var o=void 0;0!==(o=e.getStatusCode())&&t.writeUint32(1,o),(o=e.getErrorMessage()).length>0&&t.writeString(2,o),(o=e.getEventsList()).length>0&&t.writeRepeatedMessage(3,o,a.Event.serializeBinaryToWriter);},proto.flow.execution.GetTransactionResultResponse.prototype.getStatusCode=function(){return r.Message.getFieldWithDefault(this,1,0)},proto.flow.execution.GetTransactionResultResponse.prototype.setStatusCode=function(e){return r.Message.setProto3IntField(this,1,e)},proto.flow.execution.GetTransactionResultResponse.prototype.getErrorMessage=function(){return r.Message.getFieldWithDefault(this,2,"")},proto.flow.execution.GetTransactionResultResponse.prototype.setErrorMessage=function(e){return r.Message.setProto3StringField(this,2,e)},proto.flow.execution.GetTransactionResultResponse.prototype.getEventsList=function(){return r.Message.getRepeatedWrapperField(this,a.Event,3)},proto.flow.execution.GetTransactionResultResponse.prototype.setEventsList=function(e){return r.Message.setRepeatedWrapperField(this,3,e)},proto.flow.execution.GetTransactionResultResponse.prototype.addEvents=function(e,t){return r.Message.addToRepeatedWrapperField(this,3,e,proto.flow.entities.Event,t)},proto.flow.execution.GetTransactionResultResponse.prototype.clearEventsList=function(){return this.setEventsList([])},s.object.extend(t,proto.flow.execution);},function(e,t,o){var r=o(4),s=o(12).grpc,n=function(){function e(){}return e.serviceName="flow.access.AccessAPI",e}();function i(e,t){this.serviceHost=e,this.options=t||{};}n.Ping={methodName:"Ping",service:n,requestStream:!1,responseStream:!1,requestType:r.PingRequest,responseType:r.PingResponse},n.GetLatestBlockHeader={methodName:"GetLatestBlockHeader",service:n,requestStream:!1,responseStream:!1,requestType:r.GetLatestBlockHeaderRequest,responseType:r.BlockHeaderResponse},n.GetBlockHeaderByID={methodName:"GetBlockHeaderByID",service:n,requestStream:!1,responseStream:!1,requestType:r.GetBlockHeaderByIDRequest,responseType:r.BlockHeaderResponse},n.GetBlockHeaderByHeight={methodName:"GetBlockHeaderByHeight",service:n,requestStream:!1,responseStream:!1,requestType:r.GetBlockHeaderByHeightRequest,responseType:r.BlockHeaderResponse},n.GetLatestBlock={methodName:"GetLatestBlock",service:n,requestStream:!1,responseStream:!1,requestType:r.GetLatestBlockRequest,responseType:r.BlockResponse},n.GetBlockByID={methodName:"GetBlockByID",service:n,requestStream:!1,responseStream:!1,requestType:r.GetBlockByIDRequest,responseType:r.BlockResponse},n.GetBlockByHeight={methodName:"GetBlockByHeight",service:n,requestStream:!1,responseStream:!1,requestType:r.GetBlockByHeightRequest,responseType:r.BlockResponse},n.GetCollectionByID={methodName:"GetCollectionByID",service:n,requestStream:!1,responseStream:!1,requestType:r.GetCollectionByIDRequest,responseType:r.CollectionResponse},n.SendTransaction={methodName:"SendTransaction",service:n,requestStream:!1,responseStream:!1,requestType:r.SendTransactionRequest,responseType:r.SendTransactionResponse},n.GetTransaction={methodName:"GetTransaction",service:n,requestStream:!1,responseStream:!1,requestType:r.GetTransactionRequest,responseType:r.TransactionResponse},n.GetTransactionResult={methodName:"GetTransactionResult",service:n,requestStream:!1,responseStream:!1,requestType:r.GetTransactionRequest,responseType:r.TransactionResultResponse},n.GetAccount={methodName:"GetAccount",service:n,requestStream:!1,responseStream:!1,requestType:r.GetAccountRequest,responseType:r.GetAccountResponse},n.GetAccountAtLatestBlock={methodName:"GetAccountAtLatestBlock",service:n,requestStream:!1,responseStream:!1,requestType:r.GetAccountAtLatestBlockRequest,responseType:r.AccountResponse},n.GetAccountAtBlockHeight={methodName:"GetAccountAtBlockHeight",service:n,requestStream:!1,responseStream:!1,requestType:r.GetAccountAtBlockHeightRequest,responseType:r.AccountResponse},n.ExecuteScriptAtLatestBlock={methodName:"ExecuteScriptAtLatestBlock",service:n,requestStream:!1,responseStream:!1,requestType:r.ExecuteScriptAtLatestBlockRequest,responseType:r.ExecuteScriptResponse},n.ExecuteScriptAtBlockID={methodName:"ExecuteScriptAtBlockID",service:n,requestStream:!1,responseStream:!1,requestType:r.ExecuteScriptAtBlockIDRequest,responseType:r.ExecuteScriptResponse},n.ExecuteScriptAtBlockHeight={methodName:"ExecuteScriptAtBlockHeight",service:n,requestStream:!1,responseStream:!1,requestType:r.ExecuteScriptAtBlockHeightRequest,responseType:r.ExecuteScriptResponse},n.GetEventsForHeightRange={methodName:"GetEventsForHeightRange",service:n,requestStream:!1,responseStream:!1,requestType:r.GetEventsForHeightRangeRequest,responseType:r.EventsResponse},n.GetEventsForBlockIDs={methodName:"GetEventsForBlockIDs",service:n,requestStream:!1,responseStream:!1,requestType:r.GetEventsForBlockIDsRequest,responseType:r.EventsResponse},n.GetNetworkParameters={methodName:"GetNetworkParameters",service:n,requestStream:!1,responseStream:!1,requestType:r.GetNetworkParametersRequest,responseType:r.GetNetworkParametersResponse},t.AccessAPI=n,i.prototype.ping=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.Ping,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getLatestBlockHeader=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetLatestBlockHeader,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getBlockHeaderByID=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetBlockHeaderByID,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getBlockHeaderByHeight=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetBlockHeaderByHeight,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getLatestBlock=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetLatestBlock,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getBlockByID=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetBlockByID,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getBlockByHeight=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetBlockByHeight,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getCollectionByID=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetCollectionByID,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.sendTransaction=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.SendTransaction,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getTransaction=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetTransaction,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getTransactionResult=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetTransactionResult,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getAccount=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetAccount,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getAccountAtLatestBlock=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetAccountAtLatestBlock,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getAccountAtBlockHeight=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetAccountAtBlockHeight,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.executeScriptAtLatestBlock=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.ExecuteScriptAtLatestBlock,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.executeScriptAtBlockID=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.ExecuteScriptAtBlockID,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.executeScriptAtBlockHeight=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.ExecuteScriptAtBlockHeight,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getEventsForHeightRange=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetEventsForHeightRange,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getEventsForBlockIDs=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetEventsForBlockIDs,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getNetworkParameters=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetNetworkParameters,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},t.AccessAPIClient=i;},function(e,t){!function(e,t){for(var o in t)e[o]=t[o];}(t,function(e){var t={};function o(r){if(t[r])return t[r].exports;var s=t[r]={i:r,l:!1,exports:{}};return e[r].call(s.exports,s,s.exports,o),s.l=!0,s.exports}return o.m=e,o.c=t,o.d=function(e,t,r){o.o(e,t)||Object.defineProperty(e,t,{enumerable:!0,get:r});},o.r=function(e){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0});},o.t=function(e,t){if(1&t&&(e=o(e)),8&t)return e;if(4&t&&"object"==typeof e&&e&&e.__esModule)return e;var r=Object.create(null);if(o.r(r),Object.defineProperty(r,"default",{enumerable:!0,value:e}),2&t&&"string"!=typeof e)for(var s in e)o.d(r,s,function(t){return e[t]}.bind(null,s));return r},o.n=function(e){var t=e&&e.__esModule?function(){return e.default}:function(){return e};return o.d(t,"a",t),t},o.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)},o.p="",o(o.s=11)}([function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r=o(4);t.Metadata=r.BrowserHeaders;},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0}),t.debug=function(){for(var e=[],t=0;t<arguments.length;t++)e[t]=arguments[t];console.debug?console.debug.apply(null,e):console.log.apply(null,e);};},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r=null;t.default=function(e){null===r?(r=[e],setTimeout((function(){!function e(){if(r){var t=r;r=null;for(var o=0;o<t.length;o++)try{t[o]();}catch(n){null===r&&(r=[],setTimeout((function(){e();}),0));for(var s=t.length-1;s>o;s--)r.unshift(t[s]);throw n}}}();}),0)):r.push(e);};},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r=o(0),s=o(9),n=o(10),i=o(1),a=o(2),g=o(5),l=o(15);t.client=function(e,t){return new c(e,t)};var c=function(){function e(e,t){this.started=!1,this.sentFirstMessage=!1,this.completed=!1,this.closed=!1,this.finishedSending=!1,this.onHeadersCallbacks=[],this.onMessageCallbacks=[],this.onEndCallbacks=[],this.parser=new s.ChunkParser,this.methodDefinition=e,this.props=t,this.createTransport();}return e.prototype.createTransport=function(){var e=this.props.host+"/"+this.methodDefinition.service.serviceName+"/"+this.methodDefinition.methodName,t={methodDefinition:this.methodDefinition,debug:this.props.debug||!1,url:e,onHeaders:this.onTransportHeaders.bind(this),onChunk:this.onTransportChunk.bind(this),onEnd:this.onTransportEnd.bind(this)};this.props.transport?this.transport=this.props.transport(t):this.transport=g.makeDefaultTransport(t);},e.prototype.onTransportHeaders=function(e,t){if(this.props.debug&&i.debug("onHeaders",e,t),this.closed)this.props.debug&&i.debug("grpc.onHeaders received after request was closed - ignoring");else if(0===t);else {this.responseHeaders=e,this.props.debug&&i.debug("onHeaders.responseHeaders",JSON.stringify(this.responseHeaders,null,2));var o=u(e);this.props.debug&&i.debug("onHeaders.gRPCStatus",o);var r=o&&o>=0?o:n.httpStatusToCode(t);this.props.debug&&i.debug("onHeaders.code",r);var s=e.get("grpc-message")||[];if(this.props.debug&&i.debug("onHeaders.gRPCMessage",s),this.rawOnHeaders(e),r!==n.Code.OK){var a=this.decodeGRPCStatus(s[0]);this.rawOnError(r,a,e);}}},e.prototype.onTransportChunk=function(e){var t=this;if(this.closed)this.props.debug&&i.debug("grpc.onChunk received after request was closed - ignoring");else {var o=[];try{o=this.parser.parse(e);}catch(e){return this.props.debug&&i.debug("onChunk.parsing error",e,e.message),void this.rawOnError(n.Code.Internal,"parsing error: "+e.message)}o.forEach((function(e){if(e.chunkType===s.ChunkType.MESSAGE){var o=t.methodDefinition.responseType.deserializeBinary(e.data);t.rawOnMessage(o);}else e.chunkType===s.ChunkType.TRAILERS&&(t.responseHeaders?(t.responseTrailers=new r.Metadata(e.trailers),t.props.debug&&i.debug("onChunk.trailers",t.responseTrailers)):(t.responseHeaders=new r.Metadata(e.trailers),t.rawOnHeaders(t.responseHeaders)));}));}},e.prototype.onTransportEnd=function(){if(this.props.debug&&i.debug("grpc.onEnd"),this.closed)this.props.debug&&i.debug("grpc.onEnd received after request was closed - ignoring");else if(void 0!==this.responseTrailers){var e=u(this.responseTrailers);if(null!==e){var t=this.responseTrailers.get("grpc-message"),o=this.decodeGRPCStatus(t[0]);this.rawOnEnd(e,o,this.responseTrailers);}else this.rawOnError(n.Code.Internal,"Response closed without grpc-status (Trailers provided)");}else {if(void 0===this.responseHeaders)return void this.rawOnError(n.Code.Unknown,"Response closed without headers");var r=u(this.responseHeaders),s=this.responseHeaders.get("grpc-message");if(this.props.debug&&i.debug("grpc.headers only response ",r,s),null===r)return void this.rawOnEnd(n.Code.Unknown,"Response closed without grpc-status (Headers only)",this.responseHeaders);var a=this.decodeGRPCStatus(s[0]);this.rawOnEnd(r,a,this.responseHeaders);}},e.prototype.decodeGRPCStatus=function(e){if(!e)return "";try{return decodeURIComponent(e)}catch(t){return e}},e.prototype.rawOnEnd=function(e,t,o){var r=this;this.props.debug&&i.debug("rawOnEnd",e,t,o),this.completed||(this.completed=!0,this.onEndCallbacks.forEach((function(s){a.default((function(){r.closed||s(e,t,o);}));})));},e.prototype.rawOnHeaders=function(e){this.props.debug&&i.debug("rawOnHeaders",e),this.completed||this.onHeadersCallbacks.forEach((function(t){a.default((function(){t(e);}));}));},e.prototype.rawOnError=function(e,t,o){var s=this;void 0===o&&(o=new r.Metadata),this.props.debug&&i.debug("rawOnError",e,t),this.completed||(this.completed=!0,this.onEndCallbacks.forEach((function(r){a.default((function(){s.closed||r(e,t,o);}));})));},e.prototype.rawOnMessage=function(e){var t=this;this.props.debug&&i.debug("rawOnMessage",e.toObject()),this.completed||this.closed||this.onMessageCallbacks.forEach((function(o){a.default((function(){t.closed||o(e);}));}));},e.prototype.onHeaders=function(e){this.onHeadersCallbacks.push(e);},e.prototype.onMessage=function(e){this.onMessageCallbacks.push(e);},e.prototype.onEnd=function(e){this.onEndCallbacks.push(e);},e.prototype.start=function(e){if(this.started)throw new Error("Client already started - cannot .start()");this.started=!0;var t=new r.Metadata(e||{});t.set("content-type","application/grpc-web+proto"),t.set("x-grpc-web","1"),this.transport.start(t);},e.prototype.send=function(e){if(!this.started)throw new Error("Client not started - .start() must be called before .send()");if(this.closed)throw new Error("Client already closed - cannot .send()");if(this.finishedSending)throw new Error("Client already finished sending - cannot .send()");if(!this.methodDefinition.requestStream&&this.sentFirstMessage)throw new Error("Message already sent for non-client-streaming method - cannot .send()");this.sentFirstMessage=!0;var t=l.frameRequest(e);this.transport.sendMessage(t);},e.prototype.finishSend=function(){if(!this.started)throw new Error("Client not started - .finishSend() must be called before .close()");if(this.closed)throw new Error("Client already closed - cannot .send()");if(this.finishedSending)throw new Error("Client already finished sending - cannot .finishSend()");this.finishedSending=!0,this.transport.finishSend();},e.prototype.close=function(){if(!this.started)throw new Error("Client not started - .start() must be called before .close()");if(this.closed)throw new Error("Client already closed - cannot .close()");this.closed=!0,this.props.debug&&i.debug("request.abort aborting request"),this.transport.cancel();},e}();function u(e){var t=e.get("grpc-status")||[];if(t.length>0)try{var o=t[0];return parseInt(o,10)}catch(e){return null}return null}},function(e,t,o){var r;r=function(){return function(e){var t={};function o(r){if(t[r])return t[r].exports;var s=t[r]={i:r,l:!1,exports:{}};return e[r].call(s.exports,s,s.exports,o),s.l=!0,s.exports}return o.m=e,o.c=t,o.i=function(e){return e},o.d=function(e,t,r){o.o(e,t)||Object.defineProperty(e,t,{configurable:!1,enumerable:!0,get:r});},o.n=function(e){var t=e&&e.__esModule?function(){return e.default}:function(){return e};return o.d(t,"a",t),t},o.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)},o.p="",o(o.s=1)}([function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r=o(3),s=function(){function e(e,t){void 0===e&&(e={}),void 0===t&&(t={splitValues:!1});var o,s=this;this.headersMap={},e&&("undefined"!=typeof Headers&&e instanceof Headers?r.getHeaderKeys(e).forEach((function(o){r.getHeaderValues(e,o).forEach((function(e){t.splitValues?s.append(o,r.splitHeaderValue(e)):s.append(o,e);}));})):"object"==typeof(o=e)&&"object"==typeof o.headersMap&&"function"==typeof o.forEach?e.forEach((function(e,t){s.append(e,t);})):"undefined"!=typeof Map&&e instanceof Map?e.forEach((function(e,t){s.append(t,e);})):"string"==typeof e?this.appendFromString(e):"object"==typeof e&&Object.getOwnPropertyNames(e).forEach((function(t){var o=e[t];Array.isArray(o)?o.forEach((function(e){s.append(t,e);})):s.append(t,o);})));}return e.prototype.appendFromString=function(e){for(var t=e.split("\r\n"),o=0;o<t.length;o++){var r=t[o],s=r.indexOf(":");if(s>0){var n=r.substring(0,s).trim(),i=r.substring(s+1).trim();this.append(n,i);}}},e.prototype.delete=function(e,t){var o=r.normalizeName(e);if(void 0===t)delete this.headersMap[o];else {var s=this.headersMap[o];if(s){var n=s.indexOf(t);n>=0&&s.splice(n,1),0===s.length&&delete this.headersMap[o];}}},e.prototype.append=function(e,t){var o=this,s=r.normalizeName(e);Array.isArray(this.headersMap[s])||(this.headersMap[s]=[]),Array.isArray(t)?t.forEach((function(e){o.headersMap[s].push(r.normalizeValue(e));})):this.headersMap[s].push(r.normalizeValue(t));},e.prototype.set=function(e,t){var o=r.normalizeName(e);if(Array.isArray(t)){var s=[];t.forEach((function(e){s.push(r.normalizeValue(e));})),this.headersMap[o]=s;}else this.headersMap[o]=[r.normalizeValue(t)];},e.prototype.has=function(e,t){var o=this.headersMap[r.normalizeName(e)];if(!Array.isArray(o))return !1;if(void 0!==t){var s=r.normalizeValue(t);return o.indexOf(s)>=0}return !0},e.prototype.get=function(e){var t=this.headersMap[r.normalizeName(e)];return void 0!==t?t.concat():[]},e.prototype.forEach=function(e){var t=this;Object.getOwnPropertyNames(this.headersMap).forEach((function(o){e(o,t.headersMap[o]);}),this);},e.prototype.toHeaders=function(){if("undefined"!=typeof Headers){var e=new Headers;return this.forEach((function(t,o){o.forEach((function(o){e.append(t,o);}));})),e}throw new Error("Headers class is not defined")},e}();t.BrowserHeaders=s;},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r=o(0);t.BrowserHeaders=r.BrowserHeaders;},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0}),t.iterateHeaders=function(e,t){for(var o=e[Symbol.iterator](),r=o.next();!r.done;)t(r.value[0]),r=o.next();},t.iterateHeadersKeys=function(e,t){for(var o=e.keys(),r=o.next();!r.done;)t(r.value),r=o.next();};},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r=o(2);t.normalizeName=function(e){if("string"!=typeof e&&(e=String(e)),/[^a-z0-9\-#$%&'*+.\^_`|~]/i.test(e))throw new TypeError("Invalid character in header field name");return e.toLowerCase()},t.normalizeValue=function(e){return "string"!=typeof e&&(e=String(e)),e},t.getHeaderValues=function(e,t){var o=e;if(o instanceof Headers&&o.getAll)return o.getAll(t);var r=o.get(t);return r&&"string"==typeof r?[r]:r},t.getHeaderKeys=function(e){var t=e,o={},s=[];return t.keys?r.iterateHeadersKeys(t,(function(e){o[e]||(o[e]=!0,s.push(e));})):t.forEach?t.forEach((function(e,t){o[t]||(o[t]=!0,s.push(t));})):r.iterateHeaders(t,(function(e){var t=e[0];o[t]||(o[t]=!0,s.push(t));})),s},t.splitHeaderValue=function(e){var t=[];return e.split(", ").forEach((function(e){e.split(",").forEach((function(e){t.push(e);}));})),t};}])},e.exports=r();},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r=o(6),s=function(e){return r.CrossBrowserHttpTransport({withCredentials:!1})(e)};t.setDefaultTransportFactory=function(e){s=e;},t.makeDefaultTransport=function(e){return s(e)};},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r=o(7),s=o(8);t.CrossBrowserHttpTransport=function(e){if(r.detectFetchSupport()){var t={credentials:e.withCredentials?"include":"same-origin"};return r.FetchReadableStreamTransport(t)}return s.XhrTransport({withCredentials:e.withCredentials})};},function(e,t,o){var r=this&&this.__assign||function(){return (r=Object.assign||function(e){for(var t,o=1,r=arguments.length;o<r;o++)for(var s in t=arguments[o])Object.prototype.hasOwnProperty.call(t,s)&&(e[s]=t[s]);return e}).apply(this,arguments)};Object.defineProperty(t,"__esModule",{value:!0});var s=o(0),n=o(1),i=o(2);t.FetchReadableStreamTransport=function(e){return function(t){return function(e,t){return e.debug&&n.debug("fetchRequest",e),new a(e,t)}(t,e)}};var a=function(){function e(e,t){this.cancelled=!1,this.controller=self.AbortController&&new AbortController,this.options=e,this.init=t;}return e.prototype.pump=function(e,t){var o=this;if(this.reader=e,this.cancelled)return this.options.debug&&n.debug("Fetch.pump.cancel at first pump"),void this.reader.cancel();this.reader.read().then((function(e){if(e.done)return i.default((function(){o.options.onEnd();})),t;i.default((function(){o.options.onChunk(e.value);})),o.pump(o.reader,t);})).catch((function(e){o.cancelled?o.options.debug&&n.debug("Fetch.catch - request cancelled"):(o.cancelled=!0,o.options.debug&&n.debug("Fetch.catch",e.message),i.default((function(){o.options.onEnd(e);})));}));},e.prototype.send=function(e){var t=this;fetch(this.options.url,r({},this.init,{headers:this.metadata.toHeaders(),method:"POST",body:e,signal:this.controller&&this.controller.signal})).then((function(e){if(t.options.debug&&n.debug("Fetch.response",e),i.default((function(){t.options.onHeaders(new s.Metadata(e.headers),e.status);})),!e.body)return e;t.pump(e.body.getReader(),e);})).catch((function(e){t.cancelled?t.options.debug&&n.debug("Fetch.catch - request cancelled"):(t.cancelled=!0,t.options.debug&&n.debug("Fetch.catch",e.message),i.default((function(){t.options.onEnd(e);})));}));},e.prototype.sendMessage=function(e){this.send(e);},e.prototype.finishSend=function(){},e.prototype.start=function(e){this.metadata=e;},e.prototype.cancel=function(){this.cancelled?this.options.debug&&n.debug("Fetch.abort.cancel already cancelled"):(this.cancelled=!0,this.reader?(this.options.debug&&n.debug("Fetch.abort.cancel"),this.reader.cancel()):this.options.debug&&n.debug("Fetch.abort.cancel before reader"),this.controller&&this.controller.abort());},e}();t.detectFetchSupport=function(){return "undefined"!=typeof Response&&Response.prototype.hasOwnProperty("body")&&"function"==typeof Headers};},function(e,t,o){var r,s=this&&this.__extends||(r=function(e,t){return (r=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t;}||function(e,t){for(var o in t)t.hasOwnProperty(o)&&(e[o]=t[o]);})(e,t)},function(e,t){function o(){this.constructor=e;}r(e,t),e.prototype=null===t?Object.create(t):(o.prototype=t.prototype,new o);});Object.defineProperty(t,"__esModule",{value:!0});var n=o(0),i=o(1),a=o(2),g=o(12);t.XhrTransport=function(e){return function(t){if(g.detectMozXHRSupport())return new c(t,e);if(g.detectXHROverrideMimeTypeSupport())return new l(t,e);throw new Error("This environment's XHR implementation cannot support binary transfer.")}};var l=function(){function e(e,t){this.options=e,this.init=t;}return e.prototype.onProgressEvent=function(){var e=this;this.options.debug&&i.debug("XHR.onProgressEvent.length: ",this.xhr.response.length);var t=this.xhr.response.substr(this.index);this.index=this.xhr.response.length;var o=p(t);a.default((function(){e.options.onChunk(o);}));},e.prototype.onLoadEvent=function(){var e=this;this.options.debug&&i.debug("XHR.onLoadEvent"),a.default((function(){e.options.onEnd();}));},e.prototype.onStateChange=function(){var e=this;this.options.debug&&i.debug("XHR.onStateChange",this.xhr.readyState),this.xhr.readyState===XMLHttpRequest.HEADERS_RECEIVED&&a.default((function(){e.options.onHeaders(new n.Metadata(e.xhr.getAllResponseHeaders()),e.xhr.status);}));},e.prototype.sendMessage=function(e){this.xhr.send(e);},e.prototype.finishSend=function(){},e.prototype.start=function(e){var t=this;this.metadata=e;var o=new XMLHttpRequest;this.xhr=o,o.open("POST",this.options.url),this.configureXhr(),this.metadata.forEach((function(e,t){o.setRequestHeader(e,t.join(", "));})),o.withCredentials=Boolean(this.init.withCredentials),o.addEventListener("readystatechange",this.onStateChange.bind(this)),o.addEventListener("progress",this.onProgressEvent.bind(this)),o.addEventListener("loadend",this.onLoadEvent.bind(this)),o.addEventListener("error",(function(e){t.options.debug&&i.debug("XHR.error",e),a.default((function(){t.options.onEnd(e.error);}));}));},e.prototype.configureXhr=function(){this.xhr.responseType="text",this.xhr.overrideMimeType("text/plain; charset=x-user-defined");},e.prototype.cancel=function(){this.options.debug&&i.debug("XHR.abort"),this.xhr.abort();},e}();t.XHR=l;var c=function(e){function t(){return null!==e&&e.apply(this,arguments)||this}return s(t,e),t.prototype.configureXhr=function(){this.options.debug&&i.debug("MozXHR.configureXhr: setting responseType to 'moz-chunked-arraybuffer'"),this.xhr.responseType="moz-chunked-arraybuffer";},t.prototype.onProgressEvent=function(){var e=this,t=this.xhr.response;this.options.debug&&i.debug("MozXHR.onProgressEvent: ",new Uint8Array(t)),a.default((function(){e.options.onChunk(new Uint8Array(t));}));},t}(l);function u(e,t){var o=e.charCodeAt(t);if(o>=55296&&o<=56319){var r=e.charCodeAt(t+1);r>=56320&&r<=57343&&(o=65536+(o-55296<<10)+(r-56320));}return o}function p(e){for(var t=new Uint8Array(e.length),o=0,r=0;r<e.length;r++){var s=String.prototype.codePointAt?e.codePointAt(r):u(e,r);t[o++]=255&s;}return t}t.MozChunkedArrayBufferXHR=c,t.stringToArrayBuffer=p;},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r,s=o(0);function n(e){return function(e){return 9===e||10===e||13===e}(e)||e>=32&&e<=126}function i(e){for(var t=0;t!==e.length;++t)if(!n(e[t]))throw new Error("Metadata is not valid (printable) ASCII");return String.fromCharCode.apply(String,Array.prototype.slice.call(e))}function a(e){return 128==(128&e.getUint8(0))}function g(e){return e.getUint32(1,!1)}function l(e,t,o){return e.byteLength-t>=o}function c(e,t,o){if(e.slice)return e.slice(t,o);var r=e.length;void 0!==o&&(r=o);for(var s=new Uint8Array(r-t),n=0,i=t;i<r;i++)s[n++]=e[i];return s}t.decodeASCII=i,t.encodeASCII=function(e){for(var t=new Uint8Array(e.length),o=0;o!==e.length;++o){var r=e.charCodeAt(o);if(!n(r))throw new Error("Metadata contains invalid ASCII");t[o]=r;}return t},function(e){e[e.MESSAGE=1]="MESSAGE",e[e.TRAILERS=2]="TRAILERS";}(r=t.ChunkType||(t.ChunkType={}));var u=function(){function e(){this.buffer=null,this.position=0;}return e.prototype.parse=function(e,t){if(0===e.length&&t)return [];var o,n=[];if(null==this.buffer)this.buffer=e,this.position=0;else if(this.position===this.buffer.byteLength)this.buffer=e,this.position=0;else {var u=this.buffer.byteLength-this.position,p=new Uint8Array(u+e.byteLength),d=c(this.buffer,this.position);p.set(d,0);var f=new Uint8Array(e);p.set(f,u),this.buffer=p,this.position=0;}for(;;){if(!l(this.buffer,this.position,5))return n;var h=c(this.buffer,this.position,this.position+5),y=new DataView(h.buffer,h.byteOffset,h.byteLength),b=g(y);if(!l(this.buffer,this.position,5+b))return n;var m=c(this.buffer,this.position+5,this.position+5+b);if(this.position+=5+b,a(y))return n.push({chunkType:r.TRAILERS,trailers:(o=m,new s.Metadata(i(o)))}),n;n.push({chunkType:r.MESSAGE,data:m});}},e}();t.ChunkParser=u;},function(e,t,o){var r;Object.defineProperty(t,"__esModule",{value:!0}),function(e){e[e.OK=0]="OK",e[e.Canceled=1]="Canceled",e[e.Unknown=2]="Unknown",e[e.InvalidArgument=3]="InvalidArgument",e[e.DeadlineExceeded=4]="DeadlineExceeded",e[e.NotFound=5]="NotFound",e[e.AlreadyExists=6]="AlreadyExists",e[e.PermissionDenied=7]="PermissionDenied",e[e.ResourceExhausted=8]="ResourceExhausted",e[e.FailedPrecondition=9]="FailedPrecondition",e[e.Aborted=10]="Aborted",e[e.OutOfRange=11]="OutOfRange",e[e.Unimplemented=12]="Unimplemented",e[e.Internal=13]="Internal",e[e.Unavailable=14]="Unavailable",e[e.DataLoss=15]="DataLoss",e[e.Unauthenticated=16]="Unauthenticated";}(r=t.Code||(t.Code={})),t.httpStatusToCode=function(e){switch(e){case 0:return r.Internal;case 200:return r.OK;case 400:return r.InvalidArgument;case 401:return r.Unauthenticated;case 403:return r.PermissionDenied;case 404:return r.NotFound;case 409:return r.Aborted;case 412:return r.FailedPrecondition;case 429:return r.ResourceExhausted;case 499:return r.Canceled;case 500:return r.Unknown;case 501:return r.Unimplemented;case 503:return r.Unavailable;case 504:return r.DeadlineExceeded;default:return r.Unknown}};},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r=o(4),s=o(5),n=o(7),i=o(13),a=o(8),g=o(6),l=o(10),c=o(14),u=o(16),p=o(3);!function(e){e.setDefaultTransport=s.setDefaultTransportFactory,e.CrossBrowserHttpTransport=g.CrossBrowserHttpTransport,e.FetchReadableStreamTransport=n.FetchReadableStreamTransport,e.XhrTransport=a.XhrTransport,e.WebsocketTransport=i.WebsocketTransport,e.Code=l.Code,e.Metadata=r.BrowserHeaders,e.client=function(e,t){return p.client(e,t)},e.invoke=c.invoke,e.unary=u.unary;}(t.grpc||(t.grpc={}));},function(e,t,o){var r;function s(e){var t=function(){if(void 0!==r)return r;if(XMLHttpRequest){r=new XMLHttpRequest;try{r.open("GET","https://localhost");}catch(e){}}return r}();if(!t)return !1;try{return t.responseType=e,t.responseType===e}catch(e){}return !1}Object.defineProperty(t,"__esModule",{value:!0}),t.xhrSupportsResponseType=s,t.detectMozXHRSupport=function(){return "undefined"!=typeof XMLHttpRequest&&s("moz-chunked-arraybuffer")},t.detectXHROverrideMimeTypeSupport=function(){return "undefined"!=typeof XMLHttpRequest&&XMLHttpRequest.prototype.hasOwnProperty("overrideMimeType")};},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r,s=o(1),n=o(2),i=o(9);!function(e){e[e.FINISH_SEND=1]="FINISH_SEND";}(r||(r={}));var a=new Uint8Array([1]);t.WebsocketTransport=function(){return function(e){return function(e){e.debug&&s.debug("websocketRequest",e);var t,o=function(e){if("https://"===e.substr(0,8))return "wss://"+e.substr(8);if("http://"===e.substr(0,7))return "ws://"+e.substr(7);throw new Error("Websocket transport constructed with non-https:// or http:// host.")}(e.url),g=[];function l(e){if(e===r.FINISH_SEND)t.send(a);else {var o=e,s=new Int8Array(o.byteLength+1);s.set(new Uint8Array([0])),s.set(o,1),t.send(s);}}return {sendMessage:function(e){t&&t.readyState!==t.CONNECTING?l(e):g.push(e);},finishSend:function(){t&&t.readyState!==t.CONNECTING?l(r.FINISH_SEND):g.push(r.FINISH_SEND);},start:function(r){(t=new WebSocket(o,["grpc-websockets"])).binaryType="arraybuffer",t.onopen=function(){var o;e.debug&&s.debug("websocketRequest.onopen"),t.send((o="",r.forEach((function(e,t){o+=e+": "+t.join(", ")+"\r\n";})),i.encodeASCII(o))),g.forEach((function(e){l(e);}));},t.onclose=function(t){e.debug&&s.debug("websocketRequest.onclose",t),n.default((function(){e.onEnd();}));},t.onerror=function(t){e.debug&&s.debug("websocketRequest.onerror",t);},t.onmessage=function(t){n.default((function(){e.onChunk(new Uint8Array(t.data));}));};},cancel:function(){e.debug&&s.debug("websocket.abort"),n.default((function(){t.close();}));}}}(e)}};},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r=o(3);t.invoke=function(e,t){if(e.requestStream)throw new Error(".invoke cannot be used with client-streaming methods. Use .client instead.");var o=r.client(e,{host:t.host,transport:t.transport,debug:t.debug});return t.onHeaders&&o.onHeaders(t.onHeaders),t.onMessage&&o.onMessage(t.onMessage),t.onEnd&&o.onEnd(t.onEnd),o.start(t.metadata),o.send(t.request),o.finishSend(),{close:function(){o.close();}}};},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0}),t.frameRequest=function(e){var t=e.serializeBinary(),o=new ArrayBuffer(t.byteLength+5);return new DataView(o,1,4).setUint32(0,t.length,!1),new Uint8Array(o,5).set(t),new Uint8Array(o)};},function(e,t,o){Object.defineProperty(t,"__esModule",{value:!0});var r=o(0),s=o(3);t.unary=function(e,t){if(e.responseStream)throw new Error(".unary cannot be used with server-streaming methods. Use .invoke or .client instead.");if(e.requestStream)throw new Error(".unary cannot be used with client-streaming methods. Use .client instead.");var o=null,n=null,i=s.client(e,{host:t.host,transport:t.transport,debug:t.debug});return i.onHeaders((function(e){o=e;})),i.onMessage((function(e){n=e;})),i.onEnd((function(e,s,i){t.onEnd({status:e,statusMessage:s,headers:o||new r.Metadata,message:n,trailers:i});})),i.start(t.metadata),i.send(t.request),i.finishSend(),{close:function(){i.close();}}};}]));},function(e,t){},function(e,t){},function(e,t){},function(e,t){},function(e,t){},function(e,t){},function(e,t){},function(e,t,o){var r=o(10),s=o(12).grpc,n=function(){function e(){}return e.serviceName="flow.execution.ExecutionAPI",e}();function i(e,t){this.serviceHost=e,this.options=t||{};}n.Ping={methodName:"Ping",service:n,requestStream:!1,responseStream:!1,requestType:r.PingRequest,responseType:r.PingResponse},n.GetAccountAtBlockID={methodName:"GetAccountAtBlockID",service:n,requestStream:!1,responseStream:!1,requestType:r.GetAccountAtBlockIDRequest,responseType:r.GetAccountAtBlockIDResponse},n.ExecuteScriptAtBlockID={methodName:"ExecuteScriptAtBlockID",service:n,requestStream:!1,responseStream:!1,requestType:r.ExecuteScriptAtBlockIDRequest,responseType:r.ExecuteScriptAtBlockIDResponse},n.GetEventsForBlockIDs={methodName:"GetEventsForBlockIDs",service:n,requestStream:!1,responseStream:!1,requestType:r.GetEventsForBlockIDsRequest,responseType:r.GetEventsForBlockIDsResponse},n.GetTransactionResult={methodName:"GetTransactionResult",service:n,requestStream:!1,responseStream:!1,requestType:r.GetTransactionResultRequest,responseType:r.GetTransactionResultResponse},t.ExecutionAPI=n,i.prototype.ping=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.Ping,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getAccountAtBlockID=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetAccountAtBlockID,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.executeScriptAtBlockID=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.ExecuteScriptAtBlockID,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getEventsForBlockIDs=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetEventsForBlockIDs,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},i.prototype.getTransactionResult=function(e,t,o){2===arguments.length&&(o=arguments[1]);var r=s.unary(n.GetTransactionResult,{request:e,host:this.serviceHost,metadata:t,transport:this.options.transport,debug:this.options.debug,onEnd:function(e){if(o)if(e.status!==s.Code.OK){var t=new Error(e.statusMessage);t.code=e.status,t.metadata=e.trailers,o(t,null);}else o(null,e.message);}});return {cancel:function(){o=null,r.close();}}},t.ExecutionAPIClient=i;},function(e,t,o){o.r(t);var r=o(11);for(var s in r)"default"!==s&&function(e){o.d(t,e,(function(){return r[e]}));}(s);var n=o(4);for(var s in n)"default"!==s&&function(e){o.d(t,e,(function(){return n[e]}));}(s);var i=o(13);for(var s in i)"default"!==s&&function(e){o.d(t,e,(function(){return i[e]}));}(s);var a=o(1);for(var s in a)"default"!==s&&function(e){o.d(t,e,(function(){return a[e]}));}(s);var g=o(14);for(var s in g)"default"!==s&&function(e){o.d(t,e,(function(){return g[e]}));}(s);var l=o(5);for(var s in l)"default"!==s&&function(e){o.d(t,e,(function(){return l[e]}));}(s);var c=o(15);for(var s in c)"default"!==s&&function(e){o.d(t,e,(function(){return c[e]}));}(s);var u=o(7);for(var s in u)"default"!==s&&function(e){o.d(t,e,(function(){return u[e]}));}(s);var p=o(16);for(var s in p)"default"!==s&&function(e){o.d(t,e,(function(){return p[e]}));}(s);var d=o(8);for(var s in d)"default"!==s&&function(e){o.d(t,e,(function(){return d[e]}));}(s);var f=o(17);for(var s in f)"default"!==s&&function(e){o.d(t,e,(function(){return f[e]}));}(s);var h=o(2);for(var s in h)"default"!==s&&function(e){o.d(t,e,(function(){return h[e]}));}(s);var y=o(18);for(var s in y)"default"!==s&&function(e){o.d(t,e,(function(){return y[e]}));}(s);var b=o(3);for(var s in b)"default"!==s&&function(e){o.d(t,e,(function(){return b[e]}));}(s);var m=o(19);for(var s in m)"default"!==s&&function(e){o.d(t,e,(function(){return m[e]}));}(s);var _=o(9);for(var s in _)"default"!==s&&function(e){o.d(t,e,(function(){return _[e]}));}(s);var E=o(20);for(var s in E)"default"!==s&&function(e){o.d(t,e,(function(){return E[e]}));}(s);var S=o(10);for(var s in S)"default"!==s&&function(e){o.d(t,e,(function(){return S[e]}));}(s);}]);

    });

    unwrapExports(dist);
    var dist_1 = dist.Transaction;
    var dist_2 = dist.SendTransactionRequest;
    var dist_3 = dist.AccessAPI;
    var dist_4 = dist.GetTransactionRequest;
    var dist_5 = dist.ExecuteScriptAtBlockIDRequest;
    var dist_6 = dist.ExecuteScriptAtBlockHeightRequest;
    var dist_7 = dist.ExecuteScriptAtLatestBlockRequest;
    var dist_8 = dist.GetAccountAtBlockHeightRequest;
    var dist_9 = dist.GetAccountAtLatestBlockRequest;
    var dist_10 = dist.GetEventsForHeightRangeRequest;
    var dist_11 = dist.GetEventsForBlockIDsRequest;
    var dist_12 = dist.GetLatestBlockRequest;
    var dist_13 = dist.GetBlockByIDRequest;
    var dist_14 = dist.GetBlockByHeightRequest;
    var dist_15 = dist.GetBlockHeaderByIDRequest;
    var dist_16 = dist.GetBlockHeaderByHeightRequest;
    var dist_17 = dist.GetLatestBlockHeaderRequest;
    var dist_18 = dist.GetCollectionByIDRequest;
    var dist_19 = dist.PingRequest;

    function n$1(n){return null==n?null:n.replace(/^0x/,"").replace(/^Fx/,"")}function l$1(l){return null==l?null:"0x"+n$1(l)}function u$1(n){return l$1(n)}

    var grpcWebClient = createCommonjsModule(function (module, exports) {
    !function(e,t){for(var r in t)e[r]=t[r];t.__esModule&&Object.defineProperty(e,"__esModule",{value:!0});}(exports,function(){var e={418:function(e,t){!function(e,t){for(var r in t)e[r]=t[r];}(t,function(e){var t={};function r(n){if(t[n])return t[n].exports;var o=t[n]={i:n,l:!1,exports:{}};return e[n].call(o.exports,o,o.exports,r),o.l=!0,o.exports}return r.m=e,r.c=t,r.i=function(e){return e},r.d=function(e,t,n){r.o(e,t)||Object.defineProperty(e,t,{configurable:!1,enumerable:!0,get:n});},r.n=function(e){var t=e&&e.__esModule?function(){return e.default}:function(){return e};return r.d(t,"a",t),t},r.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)},r.p="",r(r.s=1)}([function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0});var n=r(3),o=function(){function e(e,t){void 0===e&&(e={}),void 0===t&&(t={splitValues:!1});var r,o=this;this.headersMap={},e&&("undefined"!=typeof Headers&&e instanceof Headers?n.getHeaderKeys(e).forEach((function(r){n.getHeaderValues(e,r).forEach((function(e){t.splitValues?o.append(r,n.splitHeaderValue(e)):o.append(r,e);}));})):"object"==typeof(r=e)&&"object"==typeof r.headersMap&&"function"==typeof r.forEach?e.forEach((function(e,t){o.append(e,t);})):"undefined"!=typeof Map&&e instanceof Map?e.forEach((function(e,t){o.append(t,e);})):"string"==typeof e?this.appendFromString(e):"object"==typeof e&&Object.getOwnPropertyNames(e).forEach((function(t){var r=e[t];Array.isArray(r)?r.forEach((function(e){o.append(t,e);})):o.append(t,r);})));}return e.prototype.appendFromString=function(e){for(var t=e.split("\r\n"),r=0;r<t.length;r++){var n=t[r],o=n.indexOf(":");if(o>0){var s=n.substring(0,o).trim(),i=n.substring(o+1).trim();this.append(s,i);}}},e.prototype.delete=function(e,t){var r=n.normalizeName(e);if(void 0===t)delete this.headersMap[r];else {var o=this.headersMap[r];if(o){var s=o.indexOf(t);s>=0&&o.splice(s,1),0===o.length&&delete this.headersMap[r];}}},e.prototype.append=function(e,t){var r=this,o=n.normalizeName(e);Array.isArray(this.headersMap[o])||(this.headersMap[o]=[]),Array.isArray(t)?t.forEach((function(e){r.headersMap[o].push(n.normalizeValue(e));})):this.headersMap[o].push(n.normalizeValue(t));},e.prototype.set=function(e,t){var r=n.normalizeName(e);if(Array.isArray(t)){var o=[];t.forEach((function(e){o.push(n.normalizeValue(e));})),this.headersMap[r]=o;}else this.headersMap[r]=[n.normalizeValue(t)];},e.prototype.has=function(e,t){var r=this.headersMap[n.normalizeName(e)];if(!Array.isArray(r))return !1;if(void 0!==t){var o=n.normalizeValue(t);return r.indexOf(o)>=0}return !0},e.prototype.get=function(e){var t=this.headersMap[n.normalizeName(e)];return void 0!==t?t.concat():[]},e.prototype.forEach=function(e){var t=this;Object.getOwnPropertyNames(this.headersMap).forEach((function(r){e(r,t.headersMap[r]);}),this);},e.prototype.toHeaders=function(){if("undefined"!=typeof Headers){var e=new Headers;return this.forEach((function(t,r){r.forEach((function(r){e.append(t,r);}));})),e}throw new Error("Headers class is not defined")},e}();t.BrowserHeaders=o;},function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0});var n=r(0);t.BrowserHeaders=n.BrowserHeaders;},function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0}),t.iterateHeaders=function(e,t){for(var r=e[Symbol.iterator](),n=r.next();!n.done;)t(n.value[0]),n=r.next();},t.iterateHeadersKeys=function(e,t){for(var r=e.keys(),n=r.next();!n.done;)t(n.value),n=r.next();};},function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0});var n=r(2);t.normalizeName=function(e){if("string"!=typeof e&&(e=String(e)),/[^a-z0-9\-#$%&'*+.\^_`|~]/i.test(e))throw new TypeError("Invalid character in header field name");return e.toLowerCase()},t.normalizeValue=function(e){return "string"!=typeof e&&(e=String(e)),e},t.getHeaderValues=function(e,t){var r=e;if(r instanceof Headers&&r.getAll)return r.getAll(t);var n=r.get(t);return n&&"string"==typeof n?[n]:n},t.getHeaderKeys=function(e){var t=e,r={},o=[];return t.keys?n.iterateHeadersKeys(t,(function(e){r[e]||(r[e]=!0,o.push(e));})):t.forEach?t.forEach((function(e,t){r[t]||(r[t]=!0,o.push(t));})):n.iterateHeaders(t,(function(e){var t=e[0];r[t]||(r[t]=!0,o.push(t));})),o},t.splitHeaderValue=function(e){var t=[];return e.split(", ").forEach((function(e){e.split(",").forEach((function(e){t.push(e);}));})),t};}]));},617:function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0}),t.ChunkParser=t.ChunkType=t.encodeASCII=t.decodeASCII=void 0;var n,o=r(65);function s(e){return 9===(t=e)||10===t||13===t||e>=32&&e<=126;var t;}function i(e){for(var t=0;t!==e.length;++t)if(!s(e[t]))throw new Error("Metadata is not valid (printable) ASCII");return String.fromCharCode.apply(String,Array.prototype.slice.call(e))}function a(e){return 128==(128&e.getUint8(0))}function u(e){return e.getUint32(1,!1)}function d(e,t,r){return e.byteLength-t>=r}function c(e,t,r){if(e.slice)return e.slice(t,r);var n=e.length;void 0!==r&&(n=r);for(var o=new Uint8Array(n-t),s=0,i=t;i<n;i++)o[s++]=e[i];return o}t.decodeASCII=i,t.encodeASCII=function(e){for(var t=new Uint8Array(e.length),r=0;r!==e.length;++r){var n=e.charCodeAt(r);if(!s(n))throw new Error("Metadata contains invalid ASCII");t[r]=n;}return t},function(e){e[e.MESSAGE=1]="MESSAGE",e[e.TRAILERS=2]="TRAILERS";}(n=t.ChunkType||(t.ChunkType={}));var p=function(){function e(){this.buffer=null,this.position=0;}return e.prototype.parse=function(e,t){if(0===e.length&&t)return [];var r,s=[];if(null==this.buffer)this.buffer=e,this.position=0;else if(this.position===this.buffer.byteLength)this.buffer=e,this.position=0;else {var p=this.buffer.byteLength-this.position,h=new Uint8Array(p+e.byteLength),f=c(this.buffer,this.position);h.set(f,0);var l=new Uint8Array(e);h.set(l,p),this.buffer=h,this.position=0;}for(;;){if(!d(this.buffer,this.position,5))return s;var g=c(this.buffer,this.position,this.position+5),b=new DataView(g.buffer,g.byteOffset,g.byteLength),y=u(b);if(!d(this.buffer,this.position,5+y))return s;var v=c(this.buffer,this.position+5,this.position+5+y);if(this.position+=5+y,a(b))return s.push({chunkType:n.TRAILERS,trailers:(r=v,new o.Metadata(i(r)))}),s;s.push({chunkType:n.MESSAGE,data:v});}},e}();t.ChunkParser=p;},8:function(e,t){var r;Object.defineProperty(t,"__esModule",{value:!0}),t.httpStatusToCode=t.Code=void 0,function(e){e[e.OK=0]="OK",e[e.Canceled=1]="Canceled",e[e.Unknown=2]="Unknown",e[e.InvalidArgument=3]="InvalidArgument",e[e.DeadlineExceeded=4]="DeadlineExceeded",e[e.NotFound=5]="NotFound",e[e.AlreadyExists=6]="AlreadyExists",e[e.PermissionDenied=7]="PermissionDenied",e[e.ResourceExhausted=8]="ResourceExhausted",e[e.FailedPrecondition=9]="FailedPrecondition",e[e.Aborted=10]="Aborted",e[e.OutOfRange=11]="OutOfRange",e[e.Unimplemented=12]="Unimplemented",e[e.Internal=13]="Internal",e[e.Unavailable=14]="Unavailable",e[e.DataLoss=15]="DataLoss",e[e.Unauthenticated=16]="Unauthenticated";}(r=t.Code||(t.Code={})),t.httpStatusToCode=function(e){switch(e){case 0:return r.Internal;case 200:return r.OK;case 400:return r.InvalidArgument;case 401:return r.Unauthenticated;case 403:return r.PermissionDenied;case 404:return r.NotFound;case 409:return r.Aborted;case 412:return r.FailedPrecondition;case 429:return r.ResourceExhausted;case 499:return r.Canceled;case 500:return r.Unknown;case 501:return r.Unimplemented;case 503:return r.Unavailable;case 504:return r.DeadlineExceeded;default:return r.Unknown}};},934:function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0}),t.client=void 0;var n=r(65),o=r(617),s=r(8),i=r(346),a=r(57),u=r(882);t.client=function(e,t){return new d(e,t)};var d=function(){function e(e,t){this.started=!1,this.sentFirstMessage=!1,this.completed=!1,this.closed=!1,this.finishedSending=!1,this.onHeadersCallbacks=[],this.onMessageCallbacks=[],this.onEndCallbacks=[],this.parser=new o.ChunkParser,this.methodDefinition=e,this.props=t,this.createTransport();}return e.prototype.createTransport=function(){var e=this.props.host+"/"+this.methodDefinition.service.serviceName+"/"+this.methodDefinition.methodName,t={methodDefinition:this.methodDefinition,debug:this.props.debug||!1,url:e,onHeaders:this.onTransportHeaders.bind(this),onChunk:this.onTransportChunk.bind(this),onEnd:this.onTransportEnd.bind(this)};this.props.transport?this.transport=this.props.transport(t):this.transport=a.makeDefaultTransport(t);},e.prototype.onTransportHeaders=function(e,t){if(this.props.debug&&i.debug("onHeaders",e,t),this.closed)this.props.debug&&i.debug("grpc.onHeaders received after request was closed - ignoring");else if(0===t);else {this.responseHeaders=e,this.props.debug&&i.debug("onHeaders.responseHeaders",JSON.stringify(this.responseHeaders,null,2));var r=c(e);this.props.debug&&i.debug("onHeaders.gRPCStatus",r);var n=r&&r>=0?r:s.httpStatusToCode(t);this.props.debug&&i.debug("onHeaders.code",n);var o=e.get("grpc-message")||[];if(this.props.debug&&i.debug("onHeaders.gRPCMessage",o),this.rawOnHeaders(e),n!==s.Code.OK){var a=this.decodeGRPCStatus(o[0]);this.rawOnError(n,a,e);}}},e.prototype.onTransportChunk=function(e){var t=this;if(this.closed)this.props.debug&&i.debug("grpc.onChunk received after request was closed - ignoring");else {var r=[];try{r=this.parser.parse(e);}catch(e){return this.props.debug&&i.debug("onChunk.parsing error",e,e.message),void this.rawOnError(s.Code.Internal,"parsing error: "+e.message)}r.forEach((function(e){if(e.chunkType===o.ChunkType.MESSAGE){var r=t.methodDefinition.responseType.deserializeBinary(e.data);t.rawOnMessage(r);}else e.chunkType===o.ChunkType.TRAILERS&&(t.responseHeaders?(t.responseTrailers=new n.Metadata(e.trailers),t.props.debug&&i.debug("onChunk.trailers",t.responseTrailers)):(t.responseHeaders=new n.Metadata(e.trailers),t.rawOnHeaders(t.responseHeaders)));}));}},e.prototype.onTransportEnd=function(){if(this.props.debug&&i.debug("grpc.onEnd"),this.closed)this.props.debug&&i.debug("grpc.onEnd received after request was closed - ignoring");else if(void 0!==this.responseTrailers){var e=c(this.responseTrailers);if(null!==e){var t=this.responseTrailers.get("grpc-message"),r=this.decodeGRPCStatus(t[0]);this.rawOnEnd(e,r,this.responseTrailers);}else this.rawOnError(s.Code.Internal,"Response closed without grpc-status (Trailers provided)");}else {if(void 0===this.responseHeaders)return void this.rawOnError(s.Code.Unknown,"Response closed without headers");var n=c(this.responseHeaders),o=this.responseHeaders.get("grpc-message");if(this.props.debug&&i.debug("grpc.headers only response ",n,o),null===n)return void this.rawOnEnd(s.Code.Unknown,"Response closed without grpc-status (Headers only)",this.responseHeaders);var a=this.decodeGRPCStatus(o[0]);this.rawOnEnd(n,a,this.responseHeaders);}},e.prototype.decodeGRPCStatus=function(e){if(!e)return "";try{return decodeURIComponent(e)}catch(t){return e}},e.prototype.rawOnEnd=function(e,t,r){var n=this;this.props.debug&&i.debug("rawOnEnd",e,t,r),this.completed||(this.completed=!0,this.onEndCallbacks.forEach((function(o){if(!n.closed)try{o(e,t,r);}catch(e){setTimeout((function(){throw e}),0);}})));},e.prototype.rawOnHeaders=function(e){this.props.debug&&i.debug("rawOnHeaders",e),this.completed||this.onHeadersCallbacks.forEach((function(t){try{t(e);}catch(e){setTimeout((function(){throw e}),0);}}));},e.prototype.rawOnError=function(e,t,r){var o=this;void 0===r&&(r=new n.Metadata),this.props.debug&&i.debug("rawOnError",e,t),this.completed||(this.completed=!0,this.onEndCallbacks.forEach((function(n){if(!o.closed)try{n(e,t,r);}catch(e){setTimeout((function(){throw e}),0);}})));},e.prototype.rawOnMessage=function(e){var t=this;this.props.debug&&i.debug("rawOnMessage",e.toObject()),this.completed||this.closed||this.onMessageCallbacks.forEach((function(r){if(!t.closed)try{r(e);}catch(e){setTimeout((function(){throw e}),0);}}));},e.prototype.onHeaders=function(e){this.onHeadersCallbacks.push(e);},e.prototype.onMessage=function(e){this.onMessageCallbacks.push(e);},e.prototype.onEnd=function(e){this.onEndCallbacks.push(e);},e.prototype.start=function(e){if(this.started)throw new Error("Client already started - cannot .start()");this.started=!0;var t=new n.Metadata(e||{});t.set("content-type","application/grpc-web+proto"),t.set("x-grpc-web","1"),this.transport.start(t);},e.prototype.send=function(e){if(!this.started)throw new Error("Client not started - .start() must be called before .send()");if(this.closed)throw new Error("Client already closed - cannot .send()");if(this.finishedSending)throw new Error("Client already finished sending - cannot .send()");if(!this.methodDefinition.requestStream&&this.sentFirstMessage)throw new Error("Message already sent for non-client-streaming method - cannot .send()");this.sentFirstMessage=!0;var t=u.frameRequest(e);this.transport.sendMessage(t);},e.prototype.finishSend=function(){if(!this.started)throw new Error("Client not started - .finishSend() must be called before .close()");if(this.closed)throw new Error("Client already closed - cannot .send()");if(this.finishedSending)throw new Error("Client already finished sending - cannot .finishSend()");this.finishedSending=!0,this.transport.finishSend();},e.prototype.close=function(){if(!this.started)throw new Error("Client not started - .start() must be called before .close()");if(this.closed)throw new Error("Client already closed - cannot .close()");this.closed=!0,this.props.debug&&i.debug("request.abort aborting request"),this.transport.cancel();},e}();function c(e){var t=e.get("grpc-status")||[];if(t.length>0)try{var r=t[0];return parseInt(r,10)}catch(e){return null}return null}},346:function(e,t){Object.defineProperty(t,"__esModule",{value:!0}),t.debug=void 0,t.debug=function(){for(var e=[],t=0;t<arguments.length;t++)e[t]=arguments[t];console.debug?console.debug.apply(null,e):console.log.apply(null,e);};},607:function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0}),t.grpc=void 0;var n,o=r(418),s=r(57),i=r(229),a=r(540),u=r(210),d=r(859),c=r(8),p=r(938),h=r(35),f=r(934);(n=t.grpc||(t.grpc={})).setDefaultTransport=s.setDefaultTransportFactory,n.CrossBrowserHttpTransport=d.CrossBrowserHttpTransport,n.FetchReadableStreamTransport=i.FetchReadableStreamTransport,n.XhrTransport=u.XhrTransport,n.WebsocketTransport=a.WebsocketTransport,n.Code=c.Code,n.Metadata=o.BrowserHeaders,n.client=function(e,t){return f.client(e,t)},n.invoke=p.invoke,n.unary=h.unary;},938:function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0}),t.invoke=void 0;var n=r(934);t.invoke=function(e,t){if(e.requestStream)throw new Error(".invoke cannot be used with client-streaming methods. Use .client instead.");var r=n.client(e,{host:t.host,transport:t.transport,debug:t.debug});return t.onHeaders&&r.onHeaders(t.onHeaders),t.onMessage&&r.onMessage(t.onMessage),t.onEnd&&r.onEnd(t.onEnd),r.start(t.metadata),r.send(t.request),r.finishSend(),{close:function(){r.close();}}};},65:function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0}),t.Metadata=void 0;var n=r(418);Object.defineProperty(t,"Metadata",{enumerable:!0,get:function(){return n.BrowserHeaders}});},57:function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0}),t.makeDefaultTransport=t.setDefaultTransportFactory=void 0;var n=r(859),o=function(e){return n.CrossBrowserHttpTransport({withCredentials:!1})(e)};t.setDefaultTransportFactory=function(e){o=e;},t.makeDefaultTransport=function(e){return o(e)};},229:function(e,t,r){var n=this&&this.__assign||function(){return (n=Object.assign||function(e){for(var t,r=1,n=arguments.length;r<n;r++)for(var o in t=arguments[r])Object.prototype.hasOwnProperty.call(t,o)&&(e[o]=t[o]);return e}).apply(this,arguments)};Object.defineProperty(t,"__esModule",{value:!0}),t.detectFetchSupport=t.FetchReadableStreamTransport=void 0;var o=r(65),s=r(346);t.FetchReadableStreamTransport=function(e){return function(t){return function(e,t){return e.debug&&s.debug("fetchRequest",e),new i(e,t)}(t,e)}};var i=function(){function e(e,t){this.cancelled=!1,this.controller=self.AbortController&&new AbortController,this.options=e,this.init=t;}return e.prototype.pump=function(e,t){var r=this;if(this.reader=e,this.cancelled)return this.options.debug&&s.debug("Fetch.pump.cancel at first pump"),void this.reader.cancel().catch((function(e){r.options.debug&&s.debug("Fetch.pump.reader.cancel exception",e);}));this.reader.read().then((function(e){if(e.done)return r.options.onEnd(),t;r.options.onChunk(e.value),r.pump(r.reader,t);})).catch((function(e){r.cancelled?r.options.debug&&s.debug("Fetch.catch - request cancelled"):(r.cancelled=!0,r.options.debug&&s.debug("Fetch.catch",e.message),r.options.onEnd(e));}));},e.prototype.send=function(e){var t=this;fetch(this.options.url,n(n({},this.init),{headers:this.metadata.toHeaders(),method:"POST",body:e,signal:this.controller&&this.controller.signal})).then((function(e){if(t.options.debug&&s.debug("Fetch.response",e),t.options.onHeaders(new o.Metadata(e.headers),e.status),!e.body)return e;t.pump(e.body.getReader(),e);})).catch((function(e){t.cancelled?t.options.debug&&s.debug("Fetch.catch - request cancelled"):(t.cancelled=!0,t.options.debug&&s.debug("Fetch.catch",e.message),t.options.onEnd(e));}));},e.prototype.sendMessage=function(e){this.send(e);},e.prototype.finishSend=function(){},e.prototype.start=function(e){this.metadata=e;},e.prototype.cancel=function(){var e=this;this.cancelled?this.options.debug&&s.debug("Fetch.cancel already cancelled"):(this.cancelled=!0,this.controller?(this.options.debug&&s.debug("Fetch.cancel.controller.abort"),this.controller.abort()):this.options.debug&&s.debug("Fetch.cancel.missing abort controller"),this.reader?(this.options.debug&&s.debug("Fetch.cancel.reader.cancel"),this.reader.cancel().catch((function(t){e.options.debug&&s.debug("Fetch.cancel.reader.cancel exception",t);}))):this.options.debug&&s.debug("Fetch.cancel before reader"));},e}();t.detectFetchSupport=function(){return "undefined"!=typeof Response&&Response.prototype.hasOwnProperty("body")&&"function"==typeof Headers};},859:function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0}),t.CrossBrowserHttpTransport=void 0;var n=r(229),o=r(210);t.CrossBrowserHttpTransport=function(e){if(n.detectFetchSupport()){var t={credentials:e.withCredentials?"include":"same-origin"};return n.FetchReadableStreamTransport(t)}return o.XhrTransport({withCredentials:e.withCredentials})};},210:function(e,t,r){var n,o=this&&this.__extends||(n=function(e,t){return (n=Object.setPrototypeOf||{__proto__:[]}instanceof Array&&function(e,t){e.__proto__=t;}||function(e,t){for(var r in t)Object.prototype.hasOwnProperty.call(t,r)&&(e[r]=t[r]);})(e,t)},function(e,t){function r(){this.constructor=e;}n(e,t),e.prototype=null===t?Object.create(t):(r.prototype=t.prototype,new r);});Object.defineProperty(t,"__esModule",{value:!0}),t.stringToArrayBuffer=t.MozChunkedArrayBufferXHR=t.XHR=t.XhrTransport=void 0;var s=r(65),i=r(346),a=r(849);t.XhrTransport=function(e){return function(t){if(a.detectMozXHRSupport())return new d(t,e);if(a.detectXHROverrideMimeTypeSupport())return new u(t,e);throw new Error("This environment's XHR implementation cannot support binary transfer.")}};var u=function(){function e(e,t){this.options=e,this.init=t;}return e.prototype.onProgressEvent=function(){this.options.debug&&i.debug("XHR.onProgressEvent.length: ",this.xhr.response.length);var e=this.xhr.response.substr(this.index);this.index=this.xhr.response.length;var t=p(e);this.options.onChunk(t);},e.prototype.onLoadEvent=function(){this.options.debug&&i.debug("XHR.onLoadEvent"),this.options.onEnd();},e.prototype.onStateChange=function(){this.options.debug&&i.debug("XHR.onStateChange",this.xhr.readyState),this.xhr.readyState===XMLHttpRequest.HEADERS_RECEIVED&&this.options.onHeaders(new s.Metadata(this.xhr.getAllResponseHeaders()),this.xhr.status);},e.prototype.sendMessage=function(e){this.xhr.send(e);},e.prototype.finishSend=function(){},e.prototype.start=function(e){var t=this;this.metadata=e;var r=new XMLHttpRequest;this.xhr=r,r.open("POST",this.options.url),this.configureXhr(),this.metadata.forEach((function(e,t){r.setRequestHeader(e,t.join(", "));})),r.withCredentials=Boolean(this.init.withCredentials),r.addEventListener("readystatechange",this.onStateChange.bind(this)),r.addEventListener("progress",this.onProgressEvent.bind(this)),r.addEventListener("loadend",this.onLoadEvent.bind(this)),r.addEventListener("error",(function(e){t.options.debug&&i.debug("XHR.error",e),t.options.onEnd(e.error);}));},e.prototype.configureXhr=function(){this.xhr.responseType="text",this.xhr.overrideMimeType("text/plain; charset=x-user-defined");},e.prototype.cancel=function(){this.options.debug&&i.debug("XHR.abort"),this.xhr.abort();},e}();t.XHR=u;var d=function(e){function t(){return null!==e&&e.apply(this,arguments)||this}return o(t,e),t.prototype.configureXhr=function(){this.options.debug&&i.debug("MozXHR.configureXhr: setting responseType to 'moz-chunked-arraybuffer'"),this.xhr.responseType="moz-chunked-arraybuffer";},t.prototype.onProgressEvent=function(){var e=this.xhr.response;this.options.debug&&i.debug("MozXHR.onProgressEvent: ",new Uint8Array(e)),this.options.onChunk(new Uint8Array(e));},t}(u);function c(e,t){var r=e.charCodeAt(t);if(r>=55296&&r<=56319){var n=e.charCodeAt(t+1);n>=56320&&n<=57343&&(r=65536+(r-55296<<10)+(n-56320));}return r}function p(e){for(var t=new Uint8Array(e.length),r=0,n=0;n<e.length;n++){var o=String.prototype.codePointAt?e.codePointAt(n):c(e,n);t[r++]=255&o;}return t}t.MozChunkedArrayBufferXHR=d,t.stringToArrayBuffer=p;},849:function(e,t){var r;function n(){if(void 0!==r)return r;if(XMLHttpRequest){r=new XMLHttpRequest;try{r.open("GET","https://localhost");}catch(e){}}return r}function o(e){var t=n();if(!t)return !1;try{return t.responseType=e,t.responseType===e}catch(e){}return !1}Object.defineProperty(t,"__esModule",{value:!0}),t.detectXHROverrideMimeTypeSupport=t.detectMozXHRSupport=t.xhrSupportsResponseType=void 0,t.xhrSupportsResponseType=o,t.detectMozXHRSupport=function(){return "undefined"!=typeof XMLHttpRequest&&o("moz-chunked-arraybuffer")},t.detectXHROverrideMimeTypeSupport=function(){return "undefined"!=typeof XMLHttpRequest&&XMLHttpRequest.prototype.hasOwnProperty("overrideMimeType")};},540:function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0}),t.WebsocketTransport=void 0;var n,o=r(346),s=r(617);!function(e){e[e.FINISH_SEND=1]="FINISH_SEND";}(n||(n={}));var i=new Uint8Array([1]);t.WebsocketTransport=function(){return function(e){return function(e){e.debug&&o.debug("websocketRequest",e);var t,r=function(e){if("https://"===e.substr(0,8))return "wss://"+e.substr(8);if("http://"===e.substr(0,7))return "ws://"+e.substr(7);throw new Error("Websocket transport constructed with non-https:// or http:// host.")}(e.url),a=[];function u(e){if(e===n.FINISH_SEND)t.send(i);else {var r=e,o=new Int8Array(r.byteLength+1);o.set(new Uint8Array([0])),o.set(r,1),t.send(o);}}return {sendMessage:function(e){t&&t.readyState!==t.CONNECTING?u(e):a.push(e);},finishSend:function(){t&&t.readyState!==t.CONNECTING?u(n.FINISH_SEND):a.push(n.FINISH_SEND);},start:function(n){(t=new WebSocket(r,["grpc-websockets"])).binaryType="arraybuffer",t.onopen=function(){var r;e.debug&&o.debug("websocketRequest.onopen"),t.send((r="",n.forEach((function(e,t){r+=e+": "+t.join(", ")+"\r\n";})),s.encodeASCII(r))),a.forEach((function(e){u(e);}));},t.onclose=function(t){e.debug&&o.debug("websocketRequest.onclose",t),e.onEnd();},t.onerror=function(t){e.debug&&o.debug("websocketRequest.onerror",t);},t.onmessage=function(t){e.onChunk(new Uint8Array(t.data));};},cancel:function(){e.debug&&o.debug("websocket.abort"),t.close();}}}(e)}};},35:function(e,t,r){Object.defineProperty(t,"__esModule",{value:!0}),t.unary=void 0;var n=r(65),o=r(934);t.unary=function(e,t){if(e.responseStream)throw new Error(".unary cannot be used with server-streaming methods. Use .invoke or .client instead.");if(e.requestStream)throw new Error(".unary cannot be used with client-streaming methods. Use .client instead.");var r=null,s=null,i=o.client(e,{host:t.host,transport:t.transport,debug:t.debug});return i.onHeaders((function(e){r=e;})),i.onMessage((function(e){s=e;})),i.onEnd((function(e,o,i){t.onEnd({status:e,statusMessage:o,headers:r||new n.Metadata,message:s,trailers:i});})),i.start(t.metadata),i.send(t.request),i.finishSend(),{close:function(){i.close();}}};},882:function(e,t){Object.defineProperty(t,"__esModule",{value:!0}),t.frameRequest=void 0,t.frameRequest=function(e){var t=e.serializeBinary(),r=new ArrayBuffer(t.byteLength+5);return new DataView(r,1,4).setUint32(0,t.length,!1),new Uint8Array(r,5).set(t),new Uint8Array(r)};}},t={};return function r(n){if(t[n])return t[n].exports;var o=t[n]={exports:{}};return e[n].call(o.exports,o,o.exports,r),o.exports}(607)}());
    });

    unwrapExports(grpcWebClient);
    var grpcWebClient_1 = grpcWebClient.grpc;

    // shim for using process in browser
    // based off https://github.com/defunctzombie/node-process/blob/master/browser.js

    function defaultSetTimout() {
        throw new Error('setTimeout has not been defined');
    }
    function defaultClearTimeout () {
        throw new Error('clearTimeout has not been defined');
    }
    var cachedSetTimeout = defaultSetTimout;
    var cachedClearTimeout = defaultClearTimeout;
    if (typeof global$1.setTimeout === 'function') {
        cachedSetTimeout = setTimeout;
    }
    if (typeof global$1.clearTimeout === 'function') {
        cachedClearTimeout = clearTimeout;
    }

    function runTimeout(fun) {
        if (cachedSetTimeout === setTimeout) {
            //normal enviroments in sane situations
            return setTimeout(fun, 0);
        }
        // if setTimeout wasn't available but was latter defined
        if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
            cachedSetTimeout = setTimeout;
            return setTimeout(fun, 0);
        }
        try {
            // when when somebody has screwed with setTimeout but no I.E. maddness
            return cachedSetTimeout(fun, 0);
        } catch(e){
            try {
                // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
                return cachedSetTimeout.call(null, fun, 0);
            } catch(e){
                // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
                return cachedSetTimeout.call(this, fun, 0);
            }
        }


    }
    function runClearTimeout(marker) {
        if (cachedClearTimeout === clearTimeout) {
            //normal enviroments in sane situations
            return clearTimeout(marker);
        }
        // if clearTimeout wasn't available but was latter defined
        if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
            cachedClearTimeout = clearTimeout;
            return clearTimeout(marker);
        }
        try {
            // when when somebody has screwed with setTimeout but no I.E. maddness
            return cachedClearTimeout(marker);
        } catch (e){
            try {
                // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
                return cachedClearTimeout.call(null, marker);
            } catch (e){
                // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
                // Some versions of I.E. have different rules for clearTimeout vs setTimeout
                return cachedClearTimeout.call(this, marker);
            }
        }



    }
    var queue = [];
    var draining = false;
    var currentQueue;
    var queueIndex = -1;

    function cleanUpNextTick() {
        if (!draining || !currentQueue) {
            return;
        }
        draining = false;
        if (currentQueue.length) {
            queue = currentQueue.concat(queue);
        } else {
            queueIndex = -1;
        }
        if (queue.length) {
            drainQueue();
        }
    }

    function drainQueue() {
        if (draining) {
            return;
        }
        var timeout = runTimeout(cleanUpNextTick);
        draining = true;

        var len = queue.length;
        while(len) {
            currentQueue = queue;
            queue = [];
            while (++queueIndex < len) {
                if (currentQueue) {
                    currentQueue[queueIndex].run();
                }
            }
            queueIndex = -1;
            len = queue.length;
        }
        currentQueue = null;
        draining = false;
        runClearTimeout(timeout);
    }
    function nextTick(fun) {
        var args = new Array(arguments.length - 1);
        if (arguments.length > 1) {
            for (var i = 1; i < arguments.length; i++) {
                args[i - 1] = arguments[i];
            }
        }
        queue.push(new Item(fun, args));
        if (queue.length === 1 && !draining) {
            runTimeout(drainQueue);
        }
    }
    // v8 likes predictible objects
    function Item(fun, array) {
        this.fun = fun;
        this.array = array;
    }
    Item.prototype.run = function () {
        this.fun.apply(null, this.array);
    };

    // from https://github.com/kumavis/browser-process-hrtime/blob/master/index.js
    var performance = global$1.performance || {};
    var performanceNow =
      performance.now        ||
      performance.mozNow     ||
      performance.msNow      ||
      performance.oNow       ||
      performance.webkitNow  ||
      function(){ return (new Date()).getTime() };

    var hasFetch = isFunction(global$1.fetch) && isFunction(global$1.ReadableStream);

    var _blobConstructor;
    function blobConstructor() {
      if (typeof _blobConstructor !== 'undefined') {
        return _blobConstructor;
      }
      try {
        new global$1.Blob([new ArrayBuffer(1)]);
        _blobConstructor = true;
      } catch (e) {
        _blobConstructor = false;
      }
      return _blobConstructor
    }
    var xhr;

    function checkTypeSupport(type) {
      if (!xhr) {
        xhr = new global$1.XMLHttpRequest();
        // If location.host is empty, e.g. if this page/worker was loaded
        // from a Blob, then use example.com to avoid an error
        xhr.open('GET', global$1.location.host ? '/' : 'https://example.com');
      }
      try {
        xhr.responseType = type;
        return xhr.responseType === type
      } catch (e) {
        return false
      }

    }

    // For some strange reason, Safari 7.0 reports typeof global.ArrayBuffer === 'object'.
    // Safari 7.1 appears to have fixed this bug.
    var haveArrayBuffer = typeof global$1.ArrayBuffer !== 'undefined';
    var haveSlice = haveArrayBuffer && isFunction(global$1.ArrayBuffer.prototype.slice);

    var arraybuffer = haveArrayBuffer && checkTypeSupport('arraybuffer');
      // These next two tests unavoidably show warnings in Chrome. Since fetch will always
      // be used if it's available, just return false for these to avoid the warnings.
    var msstream = !hasFetch && haveSlice && checkTypeSupport('ms-stream');
    var mozchunkedarraybuffer = !hasFetch && haveArrayBuffer &&
      checkTypeSupport('moz-chunked-arraybuffer');
    var overrideMimeType = isFunction(xhr.overrideMimeType);
    var vbArray = isFunction(global$1.VBArray);

    function isFunction(value) {
      return typeof value === 'function'
    }

    xhr = null; // Help gc

    var inherits;
    if (typeof Object.create === 'function'){
      inherits = function inherits(ctor, superCtor) {
        // implementation from standard node.js 'util' module
        ctor.super_ = superCtor;
        ctor.prototype = Object.create(superCtor.prototype, {
          constructor: {
            value: ctor,
            enumerable: false,
            writable: true,
            configurable: true
          }
        });
      };
    } else {
      inherits = function inherits(ctor, superCtor) {
        ctor.super_ = superCtor;
        var TempCtor = function () {};
        TempCtor.prototype = superCtor.prototype;
        ctor.prototype = new TempCtor();
        ctor.prototype.constructor = ctor;
      };
    }
    var inherits$1 = inherits;

    var formatRegExp = /%[sdj%]/g;
    function format(f) {
      if (!isString(f)) {
        var objects = [];
        for (var i = 0; i < arguments.length; i++) {
          objects.push(inspect(arguments[i]));
        }
        return objects.join(' ');
      }

      var i = 1;
      var args = arguments;
      var len = args.length;
      var str = String(f).replace(formatRegExp, function(x) {
        if (x === '%%') return '%';
        if (i >= len) return x;
        switch (x) {
          case '%s': return String(args[i++]);
          case '%d': return Number(args[i++]);
          case '%j':
            try {
              return JSON.stringify(args[i++]);
            } catch (_) {
              return '[Circular]';
            }
          default:
            return x;
        }
      });
      for (var x = args[i]; i < len; x = args[++i]) {
        if (isNull(x) || !isObject(x)) {
          str += ' ' + x;
        } else {
          str += ' ' + inspect(x);
        }
      }
      return str;
    }

    // Mark that a method should not be used.
    // Returns a modified function which warns once by default.
    // If --no-deprecation is set, then it is a no-op.
    function deprecate(fn, msg) {
      // Allow for deprecating things in the process of starting up.
      if (isUndefined(global$1.process)) {
        return function() {
          return deprecate(fn, msg).apply(this, arguments);
        };
      }

      var warned = false;
      function deprecated() {
        if (!warned) {
          {
            console.error(msg);
          }
          warned = true;
        }
        return fn.apply(this, arguments);
      }

      return deprecated;
    }

    var debugs = {};
    var debugEnviron;
    function debuglog(set) {
      if (isUndefined(debugEnviron))
        debugEnviron =  '';
      set = set.toUpperCase();
      if (!debugs[set]) {
        if (new RegExp('\\b' + set + '\\b', 'i').test(debugEnviron)) {
          var pid = 0;
          debugs[set] = function() {
            var msg = format.apply(null, arguments);
            console.error('%s %d: %s', set, pid, msg);
          };
        } else {
          debugs[set] = function() {};
        }
      }
      return debugs[set];
    }

    /**
     * Echos the value of a value. Trys to print the value out
     * in the best way possible given the different types.
     *
     * @param {Object} obj The object to print out.
     * @param {Object} opts Optional options object that alters the output.
     */
    /* legacy: obj, showHidden, depth, colors*/
    function inspect(obj, opts) {
      // default options
      var ctx = {
        seen: [],
        stylize: stylizeNoColor
      };
      // legacy...
      if (arguments.length >= 3) ctx.depth = arguments[2];
      if (arguments.length >= 4) ctx.colors = arguments[3];
      if (isBoolean(opts)) {
        // legacy...
        ctx.showHidden = opts;
      } else if (opts) {
        // got an "options" object
        _extend(ctx, opts);
      }
      // set default options
      if (isUndefined(ctx.showHidden)) ctx.showHidden = false;
      if (isUndefined(ctx.depth)) ctx.depth = 2;
      if (isUndefined(ctx.colors)) ctx.colors = false;
      if (isUndefined(ctx.customInspect)) ctx.customInspect = true;
      if (ctx.colors) ctx.stylize = stylizeWithColor;
      return formatValue(ctx, obj, ctx.depth);
    }

    // http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
    inspect.colors = {
      'bold' : [1, 22],
      'italic' : [3, 23],
      'underline' : [4, 24],
      'inverse' : [7, 27],
      'white' : [37, 39],
      'grey' : [90, 39],
      'black' : [30, 39],
      'blue' : [34, 39],
      'cyan' : [36, 39],
      'green' : [32, 39],
      'magenta' : [35, 39],
      'red' : [31, 39],
      'yellow' : [33, 39]
    };

    // Don't use 'blue' not visible on cmd.exe
    inspect.styles = {
      'special': 'cyan',
      'number': 'yellow',
      'boolean': 'yellow',
      'undefined': 'grey',
      'null': 'bold',
      'string': 'green',
      'date': 'magenta',
      // "name": intentionally not styling
      'regexp': 'red'
    };


    function stylizeWithColor(str, styleType) {
      var style = inspect.styles[styleType];

      if (style) {
        return '\u001b[' + inspect.colors[style][0] + 'm' + str +
               '\u001b[' + inspect.colors[style][1] + 'm';
      } else {
        return str;
      }
    }


    function stylizeNoColor(str, styleType) {
      return str;
    }


    function arrayToHash(array) {
      var hash = {};

      array.forEach(function(val, idx) {
        hash[val] = true;
      });

      return hash;
    }


    function formatValue(ctx, value, recurseTimes) {
      // Provide a hook for user-specified inspect functions.
      // Check that value is an object with an inspect function on it
      if (ctx.customInspect &&
          value &&
          isFunction$1(value.inspect) &&
          // Filter out the util module, it's inspect function is special
          value.inspect !== inspect &&
          // Also filter out any prototype objects using the circular check.
          !(value.constructor && value.constructor.prototype === value)) {
        var ret = value.inspect(recurseTimes, ctx);
        if (!isString(ret)) {
          ret = formatValue(ctx, ret, recurseTimes);
        }
        return ret;
      }

      // Primitive types cannot have properties
      var primitive = formatPrimitive(ctx, value);
      if (primitive) {
        return primitive;
      }

      // Look up the keys of the object.
      var keys = Object.keys(value);
      var visibleKeys = arrayToHash(keys);

      if (ctx.showHidden) {
        keys = Object.getOwnPropertyNames(value);
      }

      // IE doesn't make error fields non-enumerable
      // http://msdn.microsoft.com/en-us/library/ie/dww52sbt(v=vs.94).aspx
      if (isError(value)
          && (keys.indexOf('message') >= 0 || keys.indexOf('description') >= 0)) {
        return formatError(value);
      }

      // Some type of object without properties can be shortcutted.
      if (keys.length === 0) {
        if (isFunction$1(value)) {
          var name = value.name ? ': ' + value.name : '';
          return ctx.stylize('[Function' + name + ']', 'special');
        }
        if (isRegExp(value)) {
          return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
        }
        if (isDate(value)) {
          return ctx.stylize(Date.prototype.toString.call(value), 'date');
        }
        if (isError(value)) {
          return formatError(value);
        }
      }

      var base = '', array = false, braces = ['{', '}'];

      // Make Array say that they are Array
      if (isArray$1(value)) {
        array = true;
        braces = ['[', ']'];
      }

      // Make functions say that they are functions
      if (isFunction$1(value)) {
        var n = value.name ? ': ' + value.name : '';
        base = ' [Function' + n + ']';
      }

      // Make RegExps say that they are RegExps
      if (isRegExp(value)) {
        base = ' ' + RegExp.prototype.toString.call(value);
      }

      // Make dates with properties first say the date
      if (isDate(value)) {
        base = ' ' + Date.prototype.toUTCString.call(value);
      }

      // Make error with message first say the error
      if (isError(value)) {
        base = ' ' + formatError(value);
      }

      if (keys.length === 0 && (!array || value.length == 0)) {
        return braces[0] + base + braces[1];
      }

      if (recurseTimes < 0) {
        if (isRegExp(value)) {
          return ctx.stylize(RegExp.prototype.toString.call(value), 'regexp');
        } else {
          return ctx.stylize('[Object]', 'special');
        }
      }

      ctx.seen.push(value);

      var output;
      if (array) {
        output = formatArray(ctx, value, recurseTimes, visibleKeys, keys);
      } else {
        output = keys.map(function(key) {
          return formatProperty(ctx, value, recurseTimes, visibleKeys, key, array);
        });
      }

      ctx.seen.pop();

      return reduceToSingleString(output, base, braces);
    }


    function formatPrimitive(ctx, value) {
      if (isUndefined(value))
        return ctx.stylize('undefined', 'undefined');
      if (isString(value)) {
        var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                                 .replace(/'/g, "\\'")
                                                 .replace(/\\"/g, '"') + '\'';
        return ctx.stylize(simple, 'string');
      }
      if (isNumber(value))
        return ctx.stylize('' + value, 'number');
      if (isBoolean(value))
        return ctx.stylize('' + value, 'boolean');
      // For some reason typeof null is "object", so special case here.
      if (isNull(value))
        return ctx.stylize('null', 'null');
    }


    function formatError(value) {
      return '[' + Error.prototype.toString.call(value) + ']';
    }


    function formatArray(ctx, value, recurseTimes, visibleKeys, keys) {
      var output = [];
      for (var i = 0, l = value.length; i < l; ++i) {
        if (hasOwnProperty(value, String(i))) {
          output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
              String(i), true));
        } else {
          output.push('');
        }
      }
      keys.forEach(function(key) {
        if (!key.match(/^\d+$/)) {
          output.push(formatProperty(ctx, value, recurseTimes, visibleKeys,
              key, true));
        }
      });
      return output;
    }


    function formatProperty(ctx, value, recurseTimes, visibleKeys, key, array) {
      var name, str, desc;
      desc = Object.getOwnPropertyDescriptor(value, key) || { value: value[key] };
      if (desc.get) {
        if (desc.set) {
          str = ctx.stylize('[Getter/Setter]', 'special');
        } else {
          str = ctx.stylize('[Getter]', 'special');
        }
      } else {
        if (desc.set) {
          str = ctx.stylize('[Setter]', 'special');
        }
      }
      if (!hasOwnProperty(visibleKeys, key)) {
        name = '[' + key + ']';
      }
      if (!str) {
        if (ctx.seen.indexOf(desc.value) < 0) {
          if (isNull(recurseTimes)) {
            str = formatValue(ctx, desc.value, null);
          } else {
            str = formatValue(ctx, desc.value, recurseTimes - 1);
          }
          if (str.indexOf('\n') > -1) {
            if (array) {
              str = str.split('\n').map(function(line) {
                return '  ' + line;
              }).join('\n').substr(2);
            } else {
              str = '\n' + str.split('\n').map(function(line) {
                return '   ' + line;
              }).join('\n');
            }
          }
        } else {
          str = ctx.stylize('[Circular]', 'special');
        }
      }
      if (isUndefined(name)) {
        if (array && key.match(/^\d+$/)) {
          return str;
        }
        name = JSON.stringify('' + key);
        if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
          name = name.substr(1, name.length - 2);
          name = ctx.stylize(name, 'name');
        } else {
          name = name.replace(/'/g, "\\'")
                     .replace(/\\"/g, '"')
                     .replace(/(^"|"$)/g, "'");
          name = ctx.stylize(name, 'string');
        }
      }

      return name + ': ' + str;
    }


    function reduceToSingleString(output, base, braces) {
      var length = output.reduce(function(prev, cur) {
        if (cur.indexOf('\n') >= 0) ;
        return prev + cur.replace(/\u001b\[\d\d?m/g, '').length + 1;
      }, 0);

      if (length > 60) {
        return braces[0] +
               (base === '' ? '' : base + '\n ') +
               ' ' +
               output.join(',\n  ') +
               ' ' +
               braces[1];
      }

      return braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
    }


    // NOTE: These type checking functions intentionally don't use `instanceof`
    // because it is fragile and can be easily faked with `Object.create()`.
    function isArray$1(ar) {
      return Array.isArray(ar);
    }

    function isBoolean(arg) {
      return typeof arg === 'boolean';
    }

    function isNull(arg) {
      return arg === null;
    }

    function isNullOrUndefined(arg) {
      return arg == null;
    }

    function isNumber(arg) {
      return typeof arg === 'number';
    }

    function isString(arg) {
      return typeof arg === 'string';
    }

    function isUndefined(arg) {
      return arg === void 0;
    }

    function isRegExp(re) {
      return isObject(re) && objectToString(re) === '[object RegExp]';
    }

    function isObject(arg) {
      return typeof arg === 'object' && arg !== null;
    }

    function isDate(d) {
      return isObject(d) && objectToString(d) === '[object Date]';
    }

    function isError(e) {
      return isObject(e) &&
          (objectToString(e) === '[object Error]' || e instanceof Error);
    }

    function isFunction$1(arg) {
      return typeof arg === 'function';
    }

    function objectToString(o) {
      return Object.prototype.toString.call(o);
    }

    function _extend(origin, add) {
      // Don't do anything if add isn't an object
      if (!add || !isObject(add)) return origin;

      var keys = Object.keys(add);
      var i = keys.length;
      while (i--) {
        origin[keys[i]] = add[keys[i]];
      }
      return origin;
    }
    function hasOwnProperty(obj, prop) {
      return Object.prototype.hasOwnProperty.call(obj, prop);
    }

    var domain;

    // This constructor is used to store event handlers. Instantiating this is
    // faster than explicitly calling `Object.create(null)` to get a "clean" empty
    // object (tested with v8 v4.9).
    function EventHandlers() {}
    EventHandlers.prototype = Object.create(null);

    function EventEmitter() {
      EventEmitter.init.call(this);
    }

    // nodejs oddity
    // require('events') === require('events').EventEmitter
    EventEmitter.EventEmitter = EventEmitter;

    EventEmitter.usingDomains = false;

    EventEmitter.prototype.domain = undefined;
    EventEmitter.prototype._events = undefined;
    EventEmitter.prototype._maxListeners = undefined;

    // By default EventEmitters will print a warning if more than 10 listeners are
    // added to it. This is a useful default which helps finding memory leaks.
    EventEmitter.defaultMaxListeners = 10;

    EventEmitter.init = function() {
      this.domain = null;
      if (EventEmitter.usingDomains) {
        // if there is an active domain, then attach to it.
        if (domain.active ) ;
      }

      if (!this._events || this._events === Object.getPrototypeOf(this)._events) {
        this._events = new EventHandlers();
        this._eventsCount = 0;
      }

      this._maxListeners = this._maxListeners || undefined;
    };

    // Obviously not all Emitters should be limited to 10. This function allows
    // that to be increased. Set to zero for unlimited.
    EventEmitter.prototype.setMaxListeners = function setMaxListeners(n) {
      if (typeof n !== 'number' || n < 0 || isNaN(n))
        throw new TypeError('"n" argument must be a positive number');
      this._maxListeners = n;
      return this;
    };

    function $getMaxListeners(that) {
      if (that._maxListeners === undefined)
        return EventEmitter.defaultMaxListeners;
      return that._maxListeners;
    }

    EventEmitter.prototype.getMaxListeners = function getMaxListeners() {
      return $getMaxListeners(this);
    };

    // These standalone emit* functions are used to optimize calling of event
    // handlers for fast cases because emit() itself often has a variable number of
    // arguments and can be deoptimized because of that. These functions always have
    // the same number of arguments and thus do not get deoptimized, so the code
    // inside them can execute faster.
    function emitNone(handler, isFn, self) {
      if (isFn)
        handler.call(self);
      else {
        var len = handler.length;
        var listeners = arrayClone(handler, len);
        for (var i = 0; i < len; ++i)
          listeners[i].call(self);
      }
    }
    function emitOne(handler, isFn, self, arg1) {
      if (isFn)
        handler.call(self, arg1);
      else {
        var len = handler.length;
        var listeners = arrayClone(handler, len);
        for (var i = 0; i < len; ++i)
          listeners[i].call(self, arg1);
      }
    }
    function emitTwo(handler, isFn, self, arg1, arg2) {
      if (isFn)
        handler.call(self, arg1, arg2);
      else {
        var len = handler.length;
        var listeners = arrayClone(handler, len);
        for (var i = 0; i < len; ++i)
          listeners[i].call(self, arg1, arg2);
      }
    }
    function emitThree(handler, isFn, self, arg1, arg2, arg3) {
      if (isFn)
        handler.call(self, arg1, arg2, arg3);
      else {
        var len = handler.length;
        var listeners = arrayClone(handler, len);
        for (var i = 0; i < len; ++i)
          listeners[i].call(self, arg1, arg2, arg3);
      }
    }

    function emitMany(handler, isFn, self, args) {
      if (isFn)
        handler.apply(self, args);
      else {
        var len = handler.length;
        var listeners = arrayClone(handler, len);
        for (var i = 0; i < len; ++i)
          listeners[i].apply(self, args);
      }
    }

    EventEmitter.prototype.emit = function emit(type) {
      var er, handler, len, args, i, events, domain;
      var doError = (type === 'error');

      events = this._events;
      if (events)
        doError = (doError && events.error == null);
      else if (!doError)
        return false;

      domain = this.domain;

      // If there is no 'error' event listener then throw.
      if (doError) {
        er = arguments[1];
        if (domain) {
          if (!er)
            er = new Error('Uncaught, unspecified "error" event');
          er.domainEmitter = this;
          er.domain = domain;
          er.domainThrown = false;
          domain.emit('error', er);
        } else if (er instanceof Error) {
          throw er; // Unhandled 'error' event
        } else {
          // At least give some kind of context to the user
          var err = new Error('Uncaught, unspecified "error" event. (' + er + ')');
          err.context = er;
          throw err;
        }
        return false;
      }

      handler = events[type];

      if (!handler)
        return false;

      var isFn = typeof handler === 'function';
      len = arguments.length;
      switch (len) {
        // fast cases
        case 1:
          emitNone(handler, isFn, this);
          break;
        case 2:
          emitOne(handler, isFn, this, arguments[1]);
          break;
        case 3:
          emitTwo(handler, isFn, this, arguments[1], arguments[2]);
          break;
        case 4:
          emitThree(handler, isFn, this, arguments[1], arguments[2], arguments[3]);
          break;
        // slower
        default:
          args = new Array(len - 1);
          for (i = 1; i < len; i++)
            args[i - 1] = arguments[i];
          emitMany(handler, isFn, this, args);
      }

      return true;
    };

    function _addListener(target, type, listener, prepend) {
      var m;
      var events;
      var existing;

      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');

      events = target._events;
      if (!events) {
        events = target._events = new EventHandlers();
        target._eventsCount = 0;
      } else {
        // To avoid recursion in the case that type === "newListener"! Before
        // adding it to the listeners, first emit "newListener".
        if (events.newListener) {
          target.emit('newListener', type,
                      listener.listener ? listener.listener : listener);

          // Re-assign `events` because a newListener handler could have caused the
          // this._events to be assigned to a new object
          events = target._events;
        }
        existing = events[type];
      }

      if (!existing) {
        // Optimize the case of one listener. Don't need the extra array object.
        existing = events[type] = listener;
        ++target._eventsCount;
      } else {
        if (typeof existing === 'function') {
          // Adding the second element, need to change to array.
          existing = events[type] = prepend ? [listener, existing] :
                                              [existing, listener];
        } else {
          // If we've already got an array, just append.
          if (prepend) {
            existing.unshift(listener);
          } else {
            existing.push(listener);
          }
        }

        // Check for listener leak
        if (!existing.warned) {
          m = $getMaxListeners(target);
          if (m && m > 0 && existing.length > m) {
            existing.warned = true;
            var w = new Error('Possible EventEmitter memory leak detected. ' +
                                existing.length + ' ' + type + ' listeners added. ' +
                                'Use emitter.setMaxListeners() to increase limit');
            w.name = 'MaxListenersExceededWarning';
            w.emitter = target;
            w.type = type;
            w.count = existing.length;
            emitWarning(w);
          }
        }
      }

      return target;
    }
    function emitWarning(e) {
      typeof console.warn === 'function' ? console.warn(e) : console.log(e);
    }
    EventEmitter.prototype.addListener = function addListener(type, listener) {
      return _addListener(this, type, listener, false);
    };

    EventEmitter.prototype.on = EventEmitter.prototype.addListener;

    EventEmitter.prototype.prependListener =
        function prependListener(type, listener) {
          return _addListener(this, type, listener, true);
        };

    function _onceWrap(target, type, listener) {
      var fired = false;
      function g() {
        target.removeListener(type, g);
        if (!fired) {
          fired = true;
          listener.apply(target, arguments);
        }
      }
      g.listener = listener;
      return g;
    }

    EventEmitter.prototype.once = function once(type, listener) {
      if (typeof listener !== 'function')
        throw new TypeError('"listener" argument must be a function');
      this.on(type, _onceWrap(this, type, listener));
      return this;
    };

    EventEmitter.prototype.prependOnceListener =
        function prependOnceListener(type, listener) {
          if (typeof listener !== 'function')
            throw new TypeError('"listener" argument must be a function');
          this.prependListener(type, _onceWrap(this, type, listener));
          return this;
        };

    // emits a 'removeListener' event iff the listener was removed
    EventEmitter.prototype.removeListener =
        function removeListener(type, listener) {
          var list, events, position, i, originalListener;

          if (typeof listener !== 'function')
            throw new TypeError('"listener" argument must be a function');

          events = this._events;
          if (!events)
            return this;

          list = events[type];
          if (!list)
            return this;

          if (list === listener || (list.listener && list.listener === listener)) {
            if (--this._eventsCount === 0)
              this._events = new EventHandlers();
            else {
              delete events[type];
              if (events.removeListener)
                this.emit('removeListener', type, list.listener || listener);
            }
          } else if (typeof list !== 'function') {
            position = -1;

            for (i = list.length; i-- > 0;) {
              if (list[i] === listener ||
                  (list[i].listener && list[i].listener === listener)) {
                originalListener = list[i].listener;
                position = i;
                break;
              }
            }

            if (position < 0)
              return this;

            if (list.length === 1) {
              list[0] = undefined;
              if (--this._eventsCount === 0) {
                this._events = new EventHandlers();
                return this;
              } else {
                delete events[type];
              }
            } else {
              spliceOne(list, position);
            }

            if (events.removeListener)
              this.emit('removeListener', type, originalListener || listener);
          }

          return this;
        };

    EventEmitter.prototype.removeAllListeners =
        function removeAllListeners(type) {
          var listeners, events;

          events = this._events;
          if (!events)
            return this;

          // not listening for removeListener, no need to emit
          if (!events.removeListener) {
            if (arguments.length === 0) {
              this._events = new EventHandlers();
              this._eventsCount = 0;
            } else if (events[type]) {
              if (--this._eventsCount === 0)
                this._events = new EventHandlers();
              else
                delete events[type];
            }
            return this;
          }

          // emit removeListener for all listeners on all events
          if (arguments.length === 0) {
            var keys = Object.keys(events);
            for (var i = 0, key; i < keys.length; ++i) {
              key = keys[i];
              if (key === 'removeListener') continue;
              this.removeAllListeners(key);
            }
            this.removeAllListeners('removeListener');
            this._events = new EventHandlers();
            this._eventsCount = 0;
            return this;
          }

          listeners = events[type];

          if (typeof listeners === 'function') {
            this.removeListener(type, listeners);
          } else if (listeners) {
            // LIFO order
            do {
              this.removeListener(type, listeners[listeners.length - 1]);
            } while (listeners[0]);
          }

          return this;
        };

    EventEmitter.prototype.listeners = function listeners(type) {
      var evlistener;
      var ret;
      var events = this._events;

      if (!events)
        ret = [];
      else {
        evlistener = events[type];
        if (!evlistener)
          ret = [];
        else if (typeof evlistener === 'function')
          ret = [evlistener.listener || evlistener];
        else
          ret = unwrapListeners(evlistener);
      }

      return ret;
    };

    EventEmitter.listenerCount = function(emitter, type) {
      if (typeof emitter.listenerCount === 'function') {
        return emitter.listenerCount(type);
      } else {
        return listenerCount.call(emitter, type);
      }
    };

    EventEmitter.prototype.listenerCount = listenerCount;
    function listenerCount(type) {
      var events = this._events;

      if (events) {
        var evlistener = events[type];

        if (typeof evlistener === 'function') {
          return 1;
        } else if (evlistener) {
          return evlistener.length;
        }
      }

      return 0;
    }

    EventEmitter.prototype.eventNames = function eventNames() {
      return this._eventsCount > 0 ? Reflect.ownKeys(this._events) : [];
    };

    // About 1.5x faster than the two-arg version of Array#splice().
    function spliceOne(list, index) {
      for (var i = index, k = i + 1, n = list.length; k < n; i += 1, k += 1)
        list[i] = list[k];
      list.pop();
    }

    function arrayClone(arr, i) {
      var copy = new Array(i);
      while (i--)
        copy[i] = arr[i];
      return copy;
    }

    function unwrapListeners(arr) {
      var ret = new Array(arr.length);
      for (var i = 0; i < ret.length; ++i) {
        ret[i] = arr[i].listener || arr[i];
      }
      return ret;
    }

    function BufferList() {
      this.head = null;
      this.tail = null;
      this.length = 0;
    }

    BufferList.prototype.push = function (v) {
      var entry = { data: v, next: null };
      if (this.length > 0) this.tail.next = entry;else this.head = entry;
      this.tail = entry;
      ++this.length;
    };

    BufferList.prototype.unshift = function (v) {
      var entry = { data: v, next: this.head };
      if (this.length === 0) this.tail = entry;
      this.head = entry;
      ++this.length;
    };

    BufferList.prototype.shift = function () {
      if (this.length === 0) return;
      var ret = this.head.data;
      if (this.length === 1) this.head = this.tail = null;else this.head = this.head.next;
      --this.length;
      return ret;
    };

    BufferList.prototype.clear = function () {
      this.head = this.tail = null;
      this.length = 0;
    };

    BufferList.prototype.join = function (s) {
      if (this.length === 0) return '';
      var p = this.head;
      var ret = '' + p.data;
      while (p = p.next) {
        ret += s + p.data;
      }return ret;
    };

    BufferList.prototype.concat = function (n) {
      if (this.length === 0) return Buffer.alloc(0);
      if (this.length === 1) return this.head.data;
      var ret = Buffer.allocUnsafe(n >>> 0);
      var p = this.head;
      var i = 0;
      while (p) {
        p.data.copy(ret, i);
        i += p.data.length;
        p = p.next;
      }
      return ret;
    };

    // Copyright Joyent, Inc. and other Node contributors.
    var isBufferEncoding = Buffer.isEncoding
      || function(encoding) {
           switch (encoding && encoding.toLowerCase()) {
             case 'hex': case 'utf8': case 'utf-8': case 'ascii': case 'binary': case 'base64': case 'ucs2': case 'ucs-2': case 'utf16le': case 'utf-16le': case 'raw': return true;
             default: return false;
           }
         };


    function assertEncoding(encoding) {
      if (encoding && !isBufferEncoding(encoding)) {
        throw new Error('Unknown encoding: ' + encoding);
      }
    }

    // StringDecoder provides an interface for efficiently splitting a series of
    // buffers into a series of JS strings without breaking apart multi-byte
    // characters. CESU-8 is handled as part of the UTF-8 encoding.
    //
    // @TODO Handling all encodings inside a single object makes it very difficult
    // to reason about this code, so it should be split up in the future.
    // @TODO There should be a utf8-strict encoding that rejects invalid UTF-8 code
    // points as used by CESU-8.
    function StringDecoder(encoding) {
      this.encoding = (encoding || 'utf8').toLowerCase().replace(/[-_]/, '');
      assertEncoding(encoding);
      switch (this.encoding) {
        case 'utf8':
          // CESU-8 represents each of Surrogate Pair by 3-bytes
          this.surrogateSize = 3;
          break;
        case 'ucs2':
        case 'utf16le':
          // UTF-16 represents each of Surrogate Pair by 2-bytes
          this.surrogateSize = 2;
          this.detectIncompleteChar = utf16DetectIncompleteChar;
          break;
        case 'base64':
          // Base-64 stores 3 bytes in 4 chars, and pads the remainder.
          this.surrogateSize = 3;
          this.detectIncompleteChar = base64DetectIncompleteChar;
          break;
        default:
          this.write = passThroughWrite;
          return;
      }

      // Enough space to store all bytes of a single character. UTF-8 needs 4
      // bytes, but CESU-8 may require up to 6 (3 bytes per surrogate).
      this.charBuffer = new Buffer(6);
      // Number of bytes received for the current incomplete multi-byte character.
      this.charReceived = 0;
      // Number of bytes expected for the current incomplete multi-byte character.
      this.charLength = 0;
    }

    // write decodes the given buffer and returns it as JS string that is
    // guaranteed to not contain any partial multi-byte characters. Any partial
    // character found at the end of the buffer is buffered up, and will be
    // returned when calling write again with the remaining bytes.
    //
    // Note: Converting a Buffer containing an orphan surrogate to a String
    // currently works, but converting a String to a Buffer (via `new Buffer`, or
    // Buffer#write) will replace incomplete surrogates with the unicode
    // replacement character. See https://codereview.chromium.org/121173009/ .
    StringDecoder.prototype.write = function(buffer) {
      var charStr = '';
      // if our last write ended with an incomplete multibyte character
      while (this.charLength) {
        // determine how many remaining bytes this buffer has to offer for this char
        var available = (buffer.length >= this.charLength - this.charReceived) ?
            this.charLength - this.charReceived :
            buffer.length;

        // add the new bytes to the char buffer
        buffer.copy(this.charBuffer, this.charReceived, 0, available);
        this.charReceived += available;

        if (this.charReceived < this.charLength) {
          // still not enough chars in this buffer? wait for more ...
          return '';
        }

        // remove bytes belonging to the current character from the buffer
        buffer = buffer.slice(available, buffer.length);

        // get the character that was split
        charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);

        // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
        var charCode = charStr.charCodeAt(charStr.length - 1);
        if (charCode >= 0xD800 && charCode <= 0xDBFF) {
          this.charLength += this.surrogateSize;
          charStr = '';
          continue;
        }
        this.charReceived = this.charLength = 0;

        // if there are no more bytes in this buffer, just emit our char
        if (buffer.length === 0) {
          return charStr;
        }
        break;
      }

      // determine and set charLength / charReceived
      this.detectIncompleteChar(buffer);

      var end = buffer.length;
      if (this.charLength) {
        // buffer the incomplete character bytes we got
        buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
        end -= this.charReceived;
      }

      charStr += buffer.toString(this.encoding, 0, end);

      var end = charStr.length - 1;
      var charCode = charStr.charCodeAt(end);
      // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
      if (charCode >= 0xD800 && charCode <= 0xDBFF) {
        var size = this.surrogateSize;
        this.charLength += size;
        this.charReceived += size;
        this.charBuffer.copy(this.charBuffer, size, 0, size);
        buffer.copy(this.charBuffer, 0, 0, size);
        return charStr.substring(0, end);
      }

      // or just emit the charStr
      return charStr;
    };

    // detectIncompleteChar determines if there is an incomplete UTF-8 character at
    // the end of the given buffer. If so, it sets this.charLength to the byte
    // length that character, and sets this.charReceived to the number of bytes
    // that are available for this character.
    StringDecoder.prototype.detectIncompleteChar = function(buffer) {
      // determine how many bytes we have to check at the end of this buffer
      var i = (buffer.length >= 3) ? 3 : buffer.length;

      // Figure out if one of the last i bytes of our buffer announces an
      // incomplete char.
      for (; i > 0; i--) {
        var c = buffer[buffer.length - i];

        // See http://en.wikipedia.org/wiki/UTF-8#Description

        // 110XXXXX
        if (i == 1 && c >> 5 == 0x06) {
          this.charLength = 2;
          break;
        }

        // 1110XXXX
        if (i <= 2 && c >> 4 == 0x0E) {
          this.charLength = 3;
          break;
        }

        // 11110XXX
        if (i <= 3 && c >> 3 == 0x1E) {
          this.charLength = 4;
          break;
        }
      }
      this.charReceived = i;
    };

    StringDecoder.prototype.end = function(buffer) {
      var res = '';
      if (buffer && buffer.length)
        res = this.write(buffer);

      if (this.charReceived) {
        var cr = this.charReceived;
        var buf = this.charBuffer;
        var enc = this.encoding;
        res += buf.slice(0, cr).toString(enc);
      }

      return res;
    };

    function passThroughWrite(buffer) {
      return buffer.toString(this.encoding);
    }

    function utf16DetectIncompleteChar(buffer) {
      this.charReceived = buffer.length % 2;
      this.charLength = this.charReceived ? 2 : 0;
    }

    function base64DetectIncompleteChar(buffer) {
      this.charReceived = buffer.length % 3;
      this.charLength = this.charReceived ? 3 : 0;
    }

    Readable.ReadableState = ReadableState;

    var debug = debuglog('stream');
    inherits$1(Readable, EventEmitter);

    function prependListener(emitter, event, fn) {
      // Sadly this is not cacheable as some libraries bundle their own
      // event emitter implementation with them.
      if (typeof emitter.prependListener === 'function') {
        return emitter.prependListener(event, fn);
      } else {
        // This is a hack to make sure that our error handler is attached before any
        // userland ones.  NEVER DO THIS. This is here only because this code needs
        // to continue to work with older versions of Node.js that do not include
        // the prependListener() method. The goal is to eventually remove this hack.
        if (!emitter._events || !emitter._events[event])
          emitter.on(event, fn);
        else if (Array.isArray(emitter._events[event]))
          emitter._events[event].unshift(fn);
        else
          emitter._events[event] = [fn, emitter._events[event]];
      }
    }
    function listenerCount$1 (emitter, type) {
      return emitter.listeners(type).length;
    }
    function ReadableState(options, stream) {

      options = options || {};

      // object stream flag. Used to make read(n) ignore n and to
      // make all the buffer merging and length checks go away
      this.objectMode = !!options.objectMode;

      if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.readableObjectMode;

      // the point at which it stops calling _read() to fill the buffer
      // Note: 0 is a valid value, means "don't call _read preemptively ever"
      var hwm = options.highWaterMark;
      var defaultHwm = this.objectMode ? 16 : 16 * 1024;
      this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;

      // cast to ints.
      this.highWaterMark = ~ ~this.highWaterMark;

      // A linked list is used to store data chunks instead of an array because the
      // linked list can remove elements from the beginning faster than
      // array.shift()
      this.buffer = new BufferList();
      this.length = 0;
      this.pipes = null;
      this.pipesCount = 0;
      this.flowing = null;
      this.ended = false;
      this.endEmitted = false;
      this.reading = false;

      // a flag to be able to tell if the onwrite cb is called immediately,
      // or on a later tick.  We set this to true at first, because any
      // actions that shouldn't happen until "later" should generally also
      // not happen before the first write call.
      this.sync = true;

      // whenever we return null, then we set a flag to say
      // that we're awaiting a 'readable' event emission.
      this.needReadable = false;
      this.emittedReadable = false;
      this.readableListening = false;
      this.resumeScheduled = false;

      // Crypto is kind of old and crusty.  Historically, its default string
      // encoding is 'binary' so we have to make this configurable.
      // Everything else in the universe uses 'utf8', though.
      this.defaultEncoding = options.defaultEncoding || 'utf8';

      // when piping, we only care about 'readable' events that happen
      // after read()ing all the bytes and not getting any pushback.
      this.ranOut = false;

      // the number of writers that are awaiting a drain event in .pipe()s
      this.awaitDrain = 0;

      // if true, a maybeReadMore has been scheduled
      this.readingMore = false;

      this.decoder = null;
      this.encoding = null;
      if (options.encoding) {
        this.decoder = new StringDecoder(options.encoding);
        this.encoding = options.encoding;
      }
    }
    function Readable(options) {

      if (!(this instanceof Readable)) return new Readable(options);

      this._readableState = new ReadableState(options, this);

      // legacy
      this.readable = true;

      if (options && typeof options.read === 'function') this._read = options.read;

      EventEmitter.call(this);
    }

    // Manually shove something into the read() buffer.
    // This returns true if the highWaterMark has not been hit yet,
    // similar to how Writable.write() returns true if you should
    // write() some more.
    Readable.prototype.push = function (chunk, encoding) {
      var state = this._readableState;

      if (!state.objectMode && typeof chunk === 'string') {
        encoding = encoding || state.defaultEncoding;
        if (encoding !== state.encoding) {
          chunk = Buffer.from(chunk, encoding);
          encoding = '';
        }
      }

      return readableAddChunk(this, state, chunk, encoding, false);
    };

    // Unshift should *always* be something directly out of read()
    Readable.prototype.unshift = function (chunk) {
      var state = this._readableState;
      return readableAddChunk(this, state, chunk, '', true);
    };

    Readable.prototype.isPaused = function () {
      return this._readableState.flowing === false;
    };

    function readableAddChunk(stream, state, chunk, encoding, addToFront) {
      var er = chunkInvalid(state, chunk);
      if (er) {
        stream.emit('error', er);
      } else if (chunk === null) {
        state.reading = false;
        onEofChunk(stream, state);
      } else if (state.objectMode || chunk && chunk.length > 0) {
        if (state.ended && !addToFront) {
          var e = new Error('stream.push() after EOF');
          stream.emit('error', e);
        } else if (state.endEmitted && addToFront) {
          var _e = new Error('stream.unshift() after end event');
          stream.emit('error', _e);
        } else {
          var skipAdd;
          if (state.decoder && !addToFront && !encoding) {
            chunk = state.decoder.write(chunk);
            skipAdd = !state.objectMode && chunk.length === 0;
          }

          if (!addToFront) state.reading = false;

          // Don't add to the buffer if we've decoded to an empty string chunk and
          // we're not in object mode
          if (!skipAdd) {
            // if we want the data now, just emit it.
            if (state.flowing && state.length === 0 && !state.sync) {
              stream.emit('data', chunk);
              stream.read(0);
            } else {
              // update the buffer info.
              state.length += state.objectMode ? 1 : chunk.length;
              if (addToFront) state.buffer.unshift(chunk);else state.buffer.push(chunk);

              if (state.needReadable) emitReadable(stream);
            }
          }

          maybeReadMore(stream, state);
        }
      } else if (!addToFront) {
        state.reading = false;
      }

      return needMoreData(state);
    }

    // if it's past the high water mark, we can push in some more.
    // Also, if we have no data yet, we can stand some
    // more bytes.  This is to work around cases where hwm=0,
    // such as the repl.  Also, if the push() triggered a
    // readable event, and the user called read(largeNumber) such that
    // needReadable was set, then we ought to push more, so that another
    // 'readable' event will be triggered.
    function needMoreData(state) {
      return !state.ended && (state.needReadable || state.length < state.highWaterMark || state.length === 0);
    }

    // backwards compatibility.
    Readable.prototype.setEncoding = function (enc) {
      this._readableState.decoder = new StringDecoder(enc);
      this._readableState.encoding = enc;
      return this;
    };

    // Don't raise the hwm > 8MB
    var MAX_HWM = 0x800000;
    function computeNewHighWaterMark(n) {
      if (n >= MAX_HWM) {
        n = MAX_HWM;
      } else {
        // Get the next highest power of 2 to prevent increasing hwm excessively in
        // tiny amounts
        n--;
        n |= n >>> 1;
        n |= n >>> 2;
        n |= n >>> 4;
        n |= n >>> 8;
        n |= n >>> 16;
        n++;
      }
      return n;
    }

    // This function is designed to be inlinable, so please take care when making
    // changes to the function body.
    function howMuchToRead(n, state) {
      if (n <= 0 || state.length === 0 && state.ended) return 0;
      if (state.objectMode) return 1;
      if (n !== n) {
        // Only flow one buffer at a time
        if (state.flowing && state.length) return state.buffer.head.data.length;else return state.length;
      }
      // If we're asking for more than the current hwm, then raise the hwm.
      if (n > state.highWaterMark) state.highWaterMark = computeNewHighWaterMark(n);
      if (n <= state.length) return n;
      // Don't have enough
      if (!state.ended) {
        state.needReadable = true;
        return 0;
      }
      return state.length;
    }

    // you can override either this method, or the async _read(n) below.
    Readable.prototype.read = function (n) {
      debug('read', n);
      n = parseInt(n, 10);
      var state = this._readableState;
      var nOrig = n;

      if (n !== 0) state.emittedReadable = false;

      // if we're doing read(0) to trigger a readable event, but we
      // already have a bunch of data in the buffer, then just trigger
      // the 'readable' event and move on.
      if (n === 0 && state.needReadable && (state.length >= state.highWaterMark || state.ended)) {
        debug('read: emitReadable', state.length, state.ended);
        if (state.length === 0 && state.ended) endReadable(this);else emitReadable(this);
        return null;
      }

      n = howMuchToRead(n, state);

      // if we've ended, and we're now clear, then finish it up.
      if (n === 0 && state.ended) {
        if (state.length === 0) endReadable(this);
        return null;
      }

      // All the actual chunk generation logic needs to be
      // *below* the call to _read.  The reason is that in certain
      // synthetic stream cases, such as passthrough streams, _read
      // may be a completely synchronous operation which may change
      // the state of the read buffer, providing enough data when
      // before there was *not* enough.
      //
      // So, the steps are:
      // 1. Figure out what the state of things will be after we do
      // a read from the buffer.
      //
      // 2. If that resulting state will trigger a _read, then call _read.
      // Note that this may be asynchronous, or synchronous.  Yes, it is
      // deeply ugly to write APIs this way, but that still doesn't mean
      // that the Readable class should behave improperly, as streams are
      // designed to be sync/async agnostic.
      // Take note if the _read call is sync or async (ie, if the read call
      // has returned yet), so that we know whether or not it's safe to emit
      // 'readable' etc.
      //
      // 3. Actually pull the requested chunks out of the buffer and return.

      // if we need a readable event, then we need to do some reading.
      var doRead = state.needReadable;
      debug('need readable', doRead);

      // if we currently have less than the highWaterMark, then also read some
      if (state.length === 0 || state.length - n < state.highWaterMark) {
        doRead = true;
        debug('length less than watermark', doRead);
      }

      // however, if we've ended, then there's no point, and if we're already
      // reading, then it's unnecessary.
      if (state.ended || state.reading) {
        doRead = false;
        debug('reading or ended', doRead);
      } else if (doRead) {
        debug('do read');
        state.reading = true;
        state.sync = true;
        // if the length is currently zero, then we *need* a readable event.
        if (state.length === 0) state.needReadable = true;
        // call internal read method
        this._read(state.highWaterMark);
        state.sync = false;
        // If _read pushed data synchronously, then `reading` will be false,
        // and we need to re-evaluate how much data we can return to the user.
        if (!state.reading) n = howMuchToRead(nOrig, state);
      }

      var ret;
      if (n > 0) ret = fromList(n, state);else ret = null;

      if (ret === null) {
        state.needReadable = true;
        n = 0;
      } else {
        state.length -= n;
      }

      if (state.length === 0) {
        // If we have nothing in the buffer, then we want to know
        // as soon as we *do* get something into the buffer.
        if (!state.ended) state.needReadable = true;

        // If we tried to read() past the EOF, then emit end on the next tick.
        if (nOrig !== n && state.ended) endReadable(this);
      }

      if (ret !== null) this.emit('data', ret);

      return ret;
    };

    function chunkInvalid(state, chunk) {
      var er = null;
      if (!isBuffer(chunk) && typeof chunk !== 'string' && chunk !== null && chunk !== undefined && !state.objectMode) {
        er = new TypeError('Invalid non-string/buffer chunk');
      }
      return er;
    }

    function onEofChunk(stream, state) {
      if (state.ended) return;
      if (state.decoder) {
        var chunk = state.decoder.end();
        if (chunk && chunk.length) {
          state.buffer.push(chunk);
          state.length += state.objectMode ? 1 : chunk.length;
        }
      }
      state.ended = true;

      // emit 'readable' now to make sure it gets picked up.
      emitReadable(stream);
    }

    // Don't emit readable right away in sync mode, because this can trigger
    // another read() call => stack overflow.  This way, it might trigger
    // a nextTick recursion warning, but that's not so bad.
    function emitReadable(stream) {
      var state = stream._readableState;
      state.needReadable = false;
      if (!state.emittedReadable) {
        debug('emitReadable', state.flowing);
        state.emittedReadable = true;
        if (state.sync) nextTick(emitReadable_, stream);else emitReadable_(stream);
      }
    }

    function emitReadable_(stream) {
      debug('emit readable');
      stream.emit('readable');
      flow(stream);
    }

    // at this point, the user has presumably seen the 'readable' event,
    // and called read() to consume some data.  that may have triggered
    // in turn another _read(n) call, in which case reading = true if
    // it's in progress.
    // However, if we're not ended, or reading, and the length < hwm,
    // then go ahead and try to read some more preemptively.
    function maybeReadMore(stream, state) {
      if (!state.readingMore) {
        state.readingMore = true;
        nextTick(maybeReadMore_, stream, state);
      }
    }

    function maybeReadMore_(stream, state) {
      var len = state.length;
      while (!state.reading && !state.flowing && !state.ended && state.length < state.highWaterMark) {
        debug('maybeReadMore read 0');
        stream.read(0);
        if (len === state.length)
          // didn't get any data, stop spinning.
          break;else len = state.length;
      }
      state.readingMore = false;
    }

    // abstract method.  to be overridden in specific implementation classes.
    // call cb(er, data) where data is <= n in length.
    // for virtual (non-string, non-buffer) streams, "length" is somewhat
    // arbitrary, and perhaps not very meaningful.
    Readable.prototype._read = function (n) {
      this.emit('error', new Error('not implemented'));
    };

    Readable.prototype.pipe = function (dest, pipeOpts) {
      var src = this;
      var state = this._readableState;

      switch (state.pipesCount) {
        case 0:
          state.pipes = dest;
          break;
        case 1:
          state.pipes = [state.pipes, dest];
          break;
        default:
          state.pipes.push(dest);
          break;
      }
      state.pipesCount += 1;
      debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

      var doEnd = (!pipeOpts || pipeOpts.end !== false);

      var endFn = doEnd ? onend : cleanup;
      if (state.endEmitted) nextTick(endFn);else src.once('end', endFn);

      dest.on('unpipe', onunpipe);
      function onunpipe(readable) {
        debug('onunpipe');
        if (readable === src) {
          cleanup();
        }
      }

      function onend() {
        debug('onend');
        dest.end();
      }

      // when the dest drains, it reduces the awaitDrain counter
      // on the source.  This would be more elegant with a .once()
      // handler in flow(), but adding and removing repeatedly is
      // too slow.
      var ondrain = pipeOnDrain(src);
      dest.on('drain', ondrain);

      var cleanedUp = false;
      function cleanup() {
        debug('cleanup');
        // cleanup event handlers once the pipe is broken
        dest.removeListener('close', onclose);
        dest.removeListener('finish', onfinish);
        dest.removeListener('drain', ondrain);
        dest.removeListener('error', onerror);
        dest.removeListener('unpipe', onunpipe);
        src.removeListener('end', onend);
        src.removeListener('end', cleanup);
        src.removeListener('data', ondata);

        cleanedUp = true;

        // if the reader is waiting for a drain event from this
        // specific writer, then it would cause it to never start
        // flowing again.
        // So, if this is awaiting a drain, then we just call it now.
        // If we don't know, then assume that we are waiting for one.
        if (state.awaitDrain && (!dest._writableState || dest._writableState.needDrain)) ondrain();
      }

      // If the user pushes more data while we're writing to dest then we'll end up
      // in ondata again. However, we only want to increase awaitDrain once because
      // dest will only emit one 'drain' event for the multiple writes.
      // => Introduce a guard on increasing awaitDrain.
      var increasedAwaitDrain = false;
      src.on('data', ondata);
      function ondata(chunk) {
        debug('ondata');
        increasedAwaitDrain = false;
        var ret = dest.write(chunk);
        if (false === ret && !increasedAwaitDrain) {
          // If the user unpiped during `dest.write()`, it is possible
          // to get stuck in a permanently paused state if that write
          // also returned false.
          // => Check whether `dest` is still a piping destination.
          if ((state.pipesCount === 1 && state.pipes === dest || state.pipesCount > 1 && indexOf(state.pipes, dest) !== -1) && !cleanedUp) {
            debug('false write response, pause', src._readableState.awaitDrain);
            src._readableState.awaitDrain++;
            increasedAwaitDrain = true;
          }
          src.pause();
        }
      }

      // if the dest has an error, then stop piping into it.
      // however, don't suppress the throwing behavior for this.
      function onerror(er) {
        debug('onerror', er);
        unpipe();
        dest.removeListener('error', onerror);
        if (listenerCount$1(dest, 'error') === 0) dest.emit('error', er);
      }

      // Make sure our error handler is attached before userland ones.
      prependListener(dest, 'error', onerror);

      // Both close and finish should trigger unpipe, but only once.
      function onclose() {
        dest.removeListener('finish', onfinish);
        unpipe();
      }
      dest.once('close', onclose);
      function onfinish() {
        debug('onfinish');
        dest.removeListener('close', onclose);
        unpipe();
      }
      dest.once('finish', onfinish);

      function unpipe() {
        debug('unpipe');
        src.unpipe(dest);
      }

      // tell the dest that it's being piped to
      dest.emit('pipe', src);

      // start the flow if it hasn't been started already.
      if (!state.flowing) {
        debug('pipe resume');
        src.resume();
      }

      return dest;
    };

    function pipeOnDrain(src) {
      return function () {
        var state = src._readableState;
        debug('pipeOnDrain', state.awaitDrain);
        if (state.awaitDrain) state.awaitDrain--;
        if (state.awaitDrain === 0 && src.listeners('data').length) {
          state.flowing = true;
          flow(src);
        }
      };
    }

    Readable.prototype.unpipe = function (dest) {
      var state = this._readableState;

      // if we're not piping anywhere, then do nothing.
      if (state.pipesCount === 0) return this;

      // just one destination.  most common case.
      if (state.pipesCount === 1) {
        // passed in one, but it's not the right one.
        if (dest && dest !== state.pipes) return this;

        if (!dest) dest = state.pipes;

        // got a match.
        state.pipes = null;
        state.pipesCount = 0;
        state.flowing = false;
        if (dest) dest.emit('unpipe', this);
        return this;
      }

      // slow case. multiple pipe destinations.

      if (!dest) {
        // remove all.
        var dests = state.pipes;
        var len = state.pipesCount;
        state.pipes = null;
        state.pipesCount = 0;
        state.flowing = false;

        for (var _i = 0; _i < len; _i++) {
          dests[_i].emit('unpipe', this);
        }return this;
      }

      // try to find the right one.
      var i = indexOf(state.pipes, dest);
      if (i === -1) return this;

      state.pipes.splice(i, 1);
      state.pipesCount -= 1;
      if (state.pipesCount === 1) state.pipes = state.pipes[0];

      dest.emit('unpipe', this);

      return this;
    };

    // set up data events if they are asked for
    // Ensure readable listeners eventually get something
    Readable.prototype.on = function (ev, fn) {
      var res = EventEmitter.prototype.on.call(this, ev, fn);

      if (ev === 'data') {
        // Start flowing on next tick if stream isn't explicitly paused
        if (this._readableState.flowing !== false) this.resume();
      } else if (ev === 'readable') {
        var state = this._readableState;
        if (!state.endEmitted && !state.readableListening) {
          state.readableListening = state.needReadable = true;
          state.emittedReadable = false;
          if (!state.reading) {
            nextTick(nReadingNextTick, this);
          } else if (state.length) {
            emitReadable(this);
          }
        }
      }

      return res;
    };
    Readable.prototype.addListener = Readable.prototype.on;

    function nReadingNextTick(self) {
      debug('readable nexttick read 0');
      self.read(0);
    }

    // pause() and resume() are remnants of the legacy readable stream API
    // If the user uses them, then switch into old mode.
    Readable.prototype.resume = function () {
      var state = this._readableState;
      if (!state.flowing) {
        debug('resume');
        state.flowing = true;
        resume(this, state);
      }
      return this;
    };

    function resume(stream, state) {
      if (!state.resumeScheduled) {
        state.resumeScheduled = true;
        nextTick(resume_, stream, state);
      }
    }

    function resume_(stream, state) {
      if (!state.reading) {
        debug('resume read 0');
        stream.read(0);
      }

      state.resumeScheduled = false;
      state.awaitDrain = 0;
      stream.emit('resume');
      flow(stream);
      if (state.flowing && !state.reading) stream.read(0);
    }

    Readable.prototype.pause = function () {
      debug('call pause flowing=%j', this._readableState.flowing);
      if (false !== this._readableState.flowing) {
        debug('pause');
        this._readableState.flowing = false;
        this.emit('pause');
      }
      return this;
    };

    function flow(stream) {
      var state = stream._readableState;
      debug('flow', state.flowing);
      while (state.flowing && stream.read() !== null) {}
    }

    // wrap an old-style stream as the async data source.
    // This is *not* part of the readable stream interface.
    // It is an ugly unfortunate mess of history.
    Readable.prototype.wrap = function (stream) {
      var state = this._readableState;
      var paused = false;

      var self = this;
      stream.on('end', function () {
        debug('wrapped end');
        if (state.decoder && !state.ended) {
          var chunk = state.decoder.end();
          if (chunk && chunk.length) self.push(chunk);
        }

        self.push(null);
      });

      stream.on('data', function (chunk) {
        debug('wrapped data');
        if (state.decoder) chunk = state.decoder.write(chunk);

        // don't skip over falsy values in objectMode
        if (state.objectMode && (chunk === null || chunk === undefined)) return;else if (!state.objectMode && (!chunk || !chunk.length)) return;

        var ret = self.push(chunk);
        if (!ret) {
          paused = true;
          stream.pause();
        }
      });

      // proxy all the other methods.
      // important when wrapping filters and duplexes.
      for (var i in stream) {
        if (this[i] === undefined && typeof stream[i] === 'function') {
          this[i] = function (method) {
            return function () {
              return stream[method].apply(stream, arguments);
            };
          }(i);
        }
      }

      // proxy certain important events.
      var events = ['error', 'close', 'destroy', 'pause', 'resume'];
      forEach(events, function (ev) {
        stream.on(ev, self.emit.bind(self, ev));
      });

      // when we try to consume some more bytes, simply unpause the
      // underlying stream.
      self._read = function (n) {
        debug('wrapped _read', n);
        if (paused) {
          paused = false;
          stream.resume();
        }
      };

      return self;
    };

    // exposed for testing purposes only.
    Readable._fromList = fromList;

    // Pluck off n bytes from an array of buffers.
    // Length is the combined lengths of all the buffers in the list.
    // This function is designed to be inlinable, so please take care when making
    // changes to the function body.
    function fromList(n, state) {
      // nothing buffered
      if (state.length === 0) return null;

      var ret;
      if (state.objectMode) ret = state.buffer.shift();else if (!n || n >= state.length) {
        // read it all, truncate the list
        if (state.decoder) ret = state.buffer.join('');else if (state.buffer.length === 1) ret = state.buffer.head.data;else ret = state.buffer.concat(state.length);
        state.buffer.clear();
      } else {
        // read part of list
        ret = fromListPartial(n, state.buffer, state.decoder);
      }

      return ret;
    }

    // Extracts only enough buffered data to satisfy the amount requested.
    // This function is designed to be inlinable, so please take care when making
    // changes to the function body.
    function fromListPartial(n, list, hasStrings) {
      var ret;
      if (n < list.head.data.length) {
        // slice is the same for buffers and strings
        ret = list.head.data.slice(0, n);
        list.head.data = list.head.data.slice(n);
      } else if (n === list.head.data.length) {
        // first chunk is a perfect match
        ret = list.shift();
      } else {
        // result spans more than one buffer
        ret = hasStrings ? copyFromBufferString(n, list) : copyFromBuffer(n, list);
      }
      return ret;
    }

    // Copies a specified amount of characters from the list of buffered data
    // chunks.
    // This function is designed to be inlinable, so please take care when making
    // changes to the function body.
    function copyFromBufferString(n, list) {
      var p = list.head;
      var c = 1;
      var ret = p.data;
      n -= ret.length;
      while (p = p.next) {
        var str = p.data;
        var nb = n > str.length ? str.length : n;
        if (nb === str.length) ret += str;else ret += str.slice(0, n);
        n -= nb;
        if (n === 0) {
          if (nb === str.length) {
            ++c;
            if (p.next) list.head = p.next;else list.head = list.tail = null;
          } else {
            list.head = p;
            p.data = str.slice(nb);
          }
          break;
        }
        ++c;
      }
      list.length -= c;
      return ret;
    }

    // Copies a specified amount of bytes from the list of buffered data chunks.
    // This function is designed to be inlinable, so please take care when making
    // changes to the function body.
    function copyFromBuffer(n, list) {
      var ret = Buffer.allocUnsafe(n);
      var p = list.head;
      var c = 1;
      p.data.copy(ret);
      n -= p.data.length;
      while (p = p.next) {
        var buf = p.data;
        var nb = n > buf.length ? buf.length : n;
        buf.copy(ret, ret.length - n, 0, nb);
        n -= nb;
        if (n === 0) {
          if (nb === buf.length) {
            ++c;
            if (p.next) list.head = p.next;else list.head = list.tail = null;
          } else {
            list.head = p;
            p.data = buf.slice(nb);
          }
          break;
        }
        ++c;
      }
      list.length -= c;
      return ret;
    }

    function endReadable(stream) {
      var state = stream._readableState;

      // If we get here before consuming all the bytes, then that is a
      // bug in node.  Should never happen.
      if (state.length > 0) throw new Error('"endReadable()" called on non-empty stream');

      if (!state.endEmitted) {
        state.ended = true;
        nextTick(endReadableNT, state, stream);
      }
    }

    function endReadableNT(state, stream) {
      // Check that we didn't get one last unshift.
      if (!state.endEmitted && state.length === 0) {
        state.endEmitted = true;
        stream.readable = false;
        stream.emit('end');
      }
    }

    function forEach(xs, f) {
      for (var i = 0, l = xs.length; i < l; i++) {
        f(xs[i], i);
      }
    }

    function indexOf(xs, x) {
      for (var i = 0, l = xs.length; i < l; i++) {
        if (xs[i] === x) return i;
      }
      return -1;
    }

    // A bit simpler than readable streams.
    Writable.WritableState = WritableState;
    inherits$1(Writable, EventEmitter);

    function nop() {}

    function WriteReq(chunk, encoding, cb) {
      this.chunk = chunk;
      this.encoding = encoding;
      this.callback = cb;
      this.next = null;
    }

    function WritableState(options, stream) {
      Object.defineProperty(this, 'buffer', {
        get: deprecate(function () {
          return this.getBuffer();
        }, '_writableState.buffer is deprecated. Use _writableState.getBuffer ' + 'instead.')
      });
      options = options || {};

      // object stream flag to indicate whether or not this stream
      // contains buffers or objects.
      this.objectMode = !!options.objectMode;

      if (stream instanceof Duplex) this.objectMode = this.objectMode || !!options.writableObjectMode;

      // the point at which write() starts returning false
      // Note: 0 is a valid value, means that we always return false if
      // the entire buffer is not flushed immediately on write()
      var hwm = options.highWaterMark;
      var defaultHwm = this.objectMode ? 16 : 16 * 1024;
      this.highWaterMark = hwm || hwm === 0 ? hwm : defaultHwm;

      // cast to ints.
      this.highWaterMark = ~ ~this.highWaterMark;

      this.needDrain = false;
      // at the start of calling end()
      this.ending = false;
      // when end() has been called, and returned
      this.ended = false;
      // when 'finish' is emitted
      this.finished = false;

      // should we decode strings into buffers before passing to _write?
      // this is here so that some node-core streams can optimize string
      // handling at a lower level.
      var noDecode = options.decodeStrings === false;
      this.decodeStrings = !noDecode;

      // Crypto is kind of old and crusty.  Historically, its default string
      // encoding is 'binary' so we have to make this configurable.
      // Everything else in the universe uses 'utf8', though.
      this.defaultEncoding = options.defaultEncoding || 'utf8';

      // not an actual buffer we keep track of, but a measurement
      // of how much we're waiting to get pushed to some underlying
      // socket or file.
      this.length = 0;

      // a flag to see when we're in the middle of a write.
      this.writing = false;

      // when true all writes will be buffered until .uncork() call
      this.corked = 0;

      // a flag to be able to tell if the onwrite cb is called immediately,
      // or on a later tick.  We set this to true at first, because any
      // actions that shouldn't happen until "later" should generally also
      // not happen before the first write call.
      this.sync = true;

      // a flag to know if we're processing previously buffered items, which
      // may call the _write() callback in the same tick, so that we don't
      // end up in an overlapped onwrite situation.
      this.bufferProcessing = false;

      // the callback that's passed to _write(chunk,cb)
      this.onwrite = function (er) {
        onwrite(stream, er);
      };

      // the callback that the user supplies to write(chunk,encoding,cb)
      this.writecb = null;

      // the amount that is being written when _write is called.
      this.writelen = 0;

      this.bufferedRequest = null;
      this.lastBufferedRequest = null;

      // number of pending user-supplied write callbacks
      // this must be 0 before 'finish' can be emitted
      this.pendingcb = 0;

      // emit prefinish if the only thing we're waiting for is _write cbs
      // This is relevant for synchronous Transform streams
      this.prefinished = false;

      // True if the error was already emitted and should not be thrown again
      this.errorEmitted = false;

      // count buffered requests
      this.bufferedRequestCount = 0;

      // allocate the first CorkedRequest, there is always
      // one allocated and free to use, and we maintain at most two
      this.corkedRequestsFree = new CorkedRequest(this);
    }

    WritableState.prototype.getBuffer = function writableStateGetBuffer() {
      var current = this.bufferedRequest;
      var out = [];
      while (current) {
        out.push(current);
        current = current.next;
      }
      return out;
    };
    function Writable(options) {

      // Writable ctor is applied to Duplexes, though they're not
      // instanceof Writable, they're instanceof Readable.
      if (!(this instanceof Writable) && !(this instanceof Duplex)) return new Writable(options);

      this._writableState = new WritableState(options, this);

      // legacy.
      this.writable = true;

      if (options) {
        if (typeof options.write === 'function') this._write = options.write;

        if (typeof options.writev === 'function') this._writev = options.writev;
      }

      EventEmitter.call(this);
    }

    // Otherwise people can pipe Writable streams, which is just wrong.
    Writable.prototype.pipe = function () {
      this.emit('error', new Error('Cannot pipe, not readable'));
    };

    function writeAfterEnd(stream, cb) {
      var er = new Error('write after end');
      // TODO: defer error events consistently everywhere, not just the cb
      stream.emit('error', er);
      nextTick(cb, er);
    }

    // If we get something that is not a buffer, string, null, or undefined,
    // and we're not in objectMode, then that's an error.
    // Otherwise stream chunks are all considered to be of length=1, and the
    // watermarks determine how many objects to keep in the buffer, rather than
    // how many bytes or characters.
    function validChunk(stream, state, chunk, cb) {
      var valid = true;
      var er = false;
      // Always throw error if a null is written
      // if we are not in object mode then throw
      // if it is not a buffer, string, or undefined.
      if (chunk === null) {
        er = new TypeError('May not write null values to stream');
      } else if (!Buffer.isBuffer(chunk) && typeof chunk !== 'string' && chunk !== undefined && !state.objectMode) {
        er = new TypeError('Invalid non-string/buffer chunk');
      }
      if (er) {
        stream.emit('error', er);
        nextTick(cb, er);
        valid = false;
      }
      return valid;
    }

    Writable.prototype.write = function (chunk, encoding, cb) {
      var state = this._writableState;
      var ret = false;

      if (typeof encoding === 'function') {
        cb = encoding;
        encoding = null;
      }

      if (Buffer.isBuffer(chunk)) encoding = 'buffer';else if (!encoding) encoding = state.defaultEncoding;

      if (typeof cb !== 'function') cb = nop;

      if (state.ended) writeAfterEnd(this, cb);else if (validChunk(this, state, chunk, cb)) {
        state.pendingcb++;
        ret = writeOrBuffer(this, state, chunk, encoding, cb);
      }

      return ret;
    };

    Writable.prototype.cork = function () {
      var state = this._writableState;

      state.corked++;
    };

    Writable.prototype.uncork = function () {
      var state = this._writableState;

      if (state.corked) {
        state.corked--;

        if (!state.writing && !state.corked && !state.finished && !state.bufferProcessing && state.bufferedRequest) clearBuffer(this, state);
      }
    };

    Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
      // node::ParseEncoding() requires lower case.
      if (typeof encoding === 'string') encoding = encoding.toLowerCase();
      if (!(['hex', 'utf8', 'utf-8', 'ascii', 'binary', 'base64', 'ucs2', 'ucs-2', 'utf16le', 'utf-16le', 'raw'].indexOf((encoding + '').toLowerCase()) > -1)) throw new TypeError('Unknown encoding: ' + encoding);
      this._writableState.defaultEncoding = encoding;
      return this;
    };

    function decodeChunk(state, chunk, encoding) {
      if (!state.objectMode && state.decodeStrings !== false && typeof chunk === 'string') {
        chunk = Buffer.from(chunk, encoding);
      }
      return chunk;
    }

    // if we're already writing something, then just put this
    // in the queue, and wait our turn.  Otherwise, call _write
    // If we return false, then we need a drain event, so set that flag.
    function writeOrBuffer(stream, state, chunk, encoding, cb) {
      chunk = decodeChunk(state, chunk, encoding);

      if (Buffer.isBuffer(chunk)) encoding = 'buffer';
      var len = state.objectMode ? 1 : chunk.length;

      state.length += len;

      var ret = state.length < state.highWaterMark;
      // we must ensure that previous needDrain will not be reset to false.
      if (!ret) state.needDrain = true;

      if (state.writing || state.corked) {
        var last = state.lastBufferedRequest;
        state.lastBufferedRequest = new WriteReq(chunk, encoding, cb);
        if (last) {
          last.next = state.lastBufferedRequest;
        } else {
          state.bufferedRequest = state.lastBufferedRequest;
        }
        state.bufferedRequestCount += 1;
      } else {
        doWrite(stream, state, false, len, chunk, encoding, cb);
      }

      return ret;
    }

    function doWrite(stream, state, writev, len, chunk, encoding, cb) {
      state.writelen = len;
      state.writecb = cb;
      state.writing = true;
      state.sync = true;
      if (writev) stream._writev(chunk, state.onwrite);else stream._write(chunk, encoding, state.onwrite);
      state.sync = false;
    }

    function onwriteError(stream, state, sync, er, cb) {
      --state.pendingcb;
      if (sync) nextTick(cb, er);else cb(er);

      stream._writableState.errorEmitted = true;
      stream.emit('error', er);
    }

    function onwriteStateUpdate(state) {
      state.writing = false;
      state.writecb = null;
      state.length -= state.writelen;
      state.writelen = 0;
    }

    function onwrite(stream, er) {
      var state = stream._writableState;
      var sync = state.sync;
      var cb = state.writecb;

      onwriteStateUpdate(state);

      if (er) onwriteError(stream, state, sync, er, cb);else {
        // Check if we're actually ready to finish, but don't emit yet
        var finished = needFinish(state);

        if (!finished && !state.corked && !state.bufferProcessing && state.bufferedRequest) {
          clearBuffer(stream, state);
        }

        if (sync) {
          /*<replacement>*/
            nextTick(afterWrite, stream, state, finished, cb);
          /*</replacement>*/
        } else {
            afterWrite(stream, state, finished, cb);
          }
      }
    }

    function afterWrite(stream, state, finished, cb) {
      if (!finished) onwriteDrain(stream, state);
      state.pendingcb--;
      cb();
      finishMaybe(stream, state);
    }

    // Must force callback to be called on nextTick, so that we don't
    // emit 'drain' before the write() consumer gets the 'false' return
    // value, and has a chance to attach a 'drain' listener.
    function onwriteDrain(stream, state) {
      if (state.length === 0 && state.needDrain) {
        state.needDrain = false;
        stream.emit('drain');
      }
    }

    // if there's something in the buffer waiting, then process it
    function clearBuffer(stream, state) {
      state.bufferProcessing = true;
      var entry = state.bufferedRequest;

      if (stream._writev && entry && entry.next) {
        // Fast case, write everything using _writev()
        var l = state.bufferedRequestCount;
        var buffer = new Array(l);
        var holder = state.corkedRequestsFree;
        holder.entry = entry;

        var count = 0;
        while (entry) {
          buffer[count] = entry;
          entry = entry.next;
          count += 1;
        }

        doWrite(stream, state, true, state.length, buffer, '', holder.finish);

        // doWrite is almost always async, defer these to save a bit of time
        // as the hot path ends with doWrite
        state.pendingcb++;
        state.lastBufferedRequest = null;
        if (holder.next) {
          state.corkedRequestsFree = holder.next;
          holder.next = null;
        } else {
          state.corkedRequestsFree = new CorkedRequest(state);
        }
      } else {
        // Slow case, write chunks one-by-one
        while (entry) {
          var chunk = entry.chunk;
          var encoding = entry.encoding;
          var cb = entry.callback;
          var len = state.objectMode ? 1 : chunk.length;

          doWrite(stream, state, false, len, chunk, encoding, cb);
          entry = entry.next;
          // if we didn't call the onwrite immediately, then
          // it means that we need to wait until it does.
          // also, that means that the chunk and cb are currently
          // being processed, so move the buffer counter past them.
          if (state.writing) {
            break;
          }
        }

        if (entry === null) state.lastBufferedRequest = null;
      }

      state.bufferedRequestCount = 0;
      state.bufferedRequest = entry;
      state.bufferProcessing = false;
    }

    Writable.prototype._write = function (chunk, encoding, cb) {
      cb(new Error('not implemented'));
    };

    Writable.prototype._writev = null;

    Writable.prototype.end = function (chunk, encoding, cb) {
      var state = this._writableState;

      if (typeof chunk === 'function') {
        cb = chunk;
        chunk = null;
        encoding = null;
      } else if (typeof encoding === 'function') {
        cb = encoding;
        encoding = null;
      }

      if (chunk !== null && chunk !== undefined) this.write(chunk, encoding);

      // .end() fully uncorks
      if (state.corked) {
        state.corked = 1;
        this.uncork();
      }

      // ignore unnecessary end() calls.
      if (!state.ending && !state.finished) endWritable(this, state, cb);
    };

    function needFinish(state) {
      return state.ending && state.length === 0 && state.bufferedRequest === null && !state.finished && !state.writing;
    }

    function prefinish(stream, state) {
      if (!state.prefinished) {
        state.prefinished = true;
        stream.emit('prefinish');
      }
    }

    function finishMaybe(stream, state) {
      var need = needFinish(state);
      if (need) {
        if (state.pendingcb === 0) {
          prefinish(stream, state);
          state.finished = true;
          stream.emit('finish');
        } else {
          prefinish(stream, state);
        }
      }
      return need;
    }

    function endWritable(stream, state, cb) {
      state.ending = true;
      finishMaybe(stream, state);
      if (cb) {
        if (state.finished) nextTick(cb);else stream.once('finish', cb);
      }
      state.ended = true;
      stream.writable = false;
    }

    // It seems a linked list but it is not
    // there will be only 2 of these for each stream
    function CorkedRequest(state) {
      var _this = this;

      this.next = null;
      this.entry = null;

      this.finish = function (err) {
        var entry = _this.entry;
        _this.entry = null;
        while (entry) {
          var cb = entry.callback;
          state.pendingcb--;
          cb(err);
          entry = entry.next;
        }
        if (state.corkedRequestsFree) {
          state.corkedRequestsFree.next = _this;
        } else {
          state.corkedRequestsFree = _this;
        }
      };
    }

    inherits$1(Duplex, Readable);

    var keys = Object.keys(Writable.prototype);
    for (var v = 0; v < keys.length; v++) {
      var method = keys[v];
      if (!Duplex.prototype[method]) Duplex.prototype[method] = Writable.prototype[method];
    }
    function Duplex(options) {
      if (!(this instanceof Duplex)) return new Duplex(options);

      Readable.call(this, options);
      Writable.call(this, options);

      if (options && options.readable === false) this.readable = false;

      if (options && options.writable === false) this.writable = false;

      this.allowHalfOpen = true;
      if (options && options.allowHalfOpen === false) this.allowHalfOpen = false;

      this.once('end', onend);
    }

    // the no-half-open enforcer
    function onend() {
      // if we allow half-open state, or if the writable side ended,
      // then we're ok.
      if (this.allowHalfOpen || this._writableState.ended) return;

      // no more data can be written.
      // But allow more writes to happen in this tick.
      nextTick(onEndNT, this);
    }

    function onEndNT(self) {
      self.end();
    }

    // a transform stream is a readable/writable stream where you do
    inherits$1(Transform, Duplex);

    function TransformState(stream) {
      this.afterTransform = function (er, data) {
        return afterTransform(stream, er, data);
      };

      this.needTransform = false;
      this.transforming = false;
      this.writecb = null;
      this.writechunk = null;
      this.writeencoding = null;
    }

    function afterTransform(stream, er, data) {
      var ts = stream._transformState;
      ts.transforming = false;

      var cb = ts.writecb;

      if (!cb) return stream.emit('error', new Error('no writecb in Transform class'));

      ts.writechunk = null;
      ts.writecb = null;

      if (data !== null && data !== undefined) stream.push(data);

      cb(er);

      var rs = stream._readableState;
      rs.reading = false;
      if (rs.needReadable || rs.length < rs.highWaterMark) {
        stream._read(rs.highWaterMark);
      }
    }
    function Transform(options) {
      if (!(this instanceof Transform)) return new Transform(options);

      Duplex.call(this, options);

      this._transformState = new TransformState(this);

      // when the writable side finishes, then flush out anything remaining.
      var stream = this;

      // start out asking for a readable event once data is transformed.
      this._readableState.needReadable = true;

      // we have implemented the _read method, and done the other things
      // that Readable wants before the first _read call, so unset the
      // sync guard flag.
      this._readableState.sync = false;

      if (options) {
        if (typeof options.transform === 'function') this._transform = options.transform;

        if (typeof options.flush === 'function') this._flush = options.flush;
      }

      this.once('prefinish', function () {
        if (typeof this._flush === 'function') this._flush(function (er) {
          done(stream, er);
        });else done(stream);
      });
    }

    Transform.prototype.push = function (chunk, encoding) {
      this._transformState.needTransform = false;
      return Duplex.prototype.push.call(this, chunk, encoding);
    };

    // This is the part where you do stuff!
    // override this function in implementation classes.
    // 'chunk' is an input chunk.
    //
    // Call `push(newChunk)` to pass along transformed output
    // to the readable side.  You may call 'push' zero or more times.
    //
    // Call `cb(err)` when you are done with this chunk.  If you pass
    // an error, then that'll put the hurt on the whole operation.  If you
    // never call cb(), then you'll never get another chunk.
    Transform.prototype._transform = function (chunk, encoding, cb) {
      throw new Error('Not implemented');
    };

    Transform.prototype._write = function (chunk, encoding, cb) {
      var ts = this._transformState;
      ts.writecb = cb;
      ts.writechunk = chunk;
      ts.writeencoding = encoding;
      if (!ts.transforming) {
        var rs = this._readableState;
        if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark) this._read(rs.highWaterMark);
      }
    };

    // Doesn't matter what the args are here.
    // _transform does all the work.
    // That we got here means that the readable side wants more data.
    Transform.prototype._read = function (n) {
      var ts = this._transformState;

      if (ts.writechunk !== null && ts.writecb && !ts.transforming) {
        ts.transforming = true;
        this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
      } else {
        // mark that we need a transform, so that any data that comes in
        // will get processed, now that we've asked for it.
        ts.needTransform = true;
      }
    };

    function done(stream, er) {
      if (er) return stream.emit('error', er);

      // if there's nothing in the write buffer, then that means
      // that nothing more will ever be provided
      var ws = stream._writableState;
      var ts = stream._transformState;

      if (ws.length) throw new Error('Calling transform done when ws.length != 0');

      if (ts.transforming) throw new Error('Calling transform done when still transforming');

      return stream.push(null);
    }

    inherits$1(PassThrough, Transform);
    function PassThrough(options) {
      if (!(this instanceof PassThrough)) return new PassThrough(options);

      Transform.call(this, options);
    }

    PassThrough.prototype._transform = function (chunk, encoding, cb) {
      cb(null, chunk);
    };

    inherits$1(Stream, EventEmitter);
    Stream.Readable = Readable;
    Stream.Writable = Writable;
    Stream.Duplex = Duplex;
    Stream.Transform = Transform;
    Stream.PassThrough = PassThrough;

    // Backwards-compat with node 0.4.x
    Stream.Stream = Stream;

    // old-style streams.  Note that the pipe method (the only relevant
    // part of this class) is overridden in the Readable class.

    function Stream() {
      EventEmitter.call(this);
    }

    Stream.prototype.pipe = function(dest, options) {
      var source = this;

      function ondata(chunk) {
        if (dest.writable) {
          if (false === dest.write(chunk) && source.pause) {
            source.pause();
          }
        }
      }

      source.on('data', ondata);

      function ondrain() {
        if (source.readable && source.resume) {
          source.resume();
        }
      }

      dest.on('drain', ondrain);

      // If the 'end' option is not supplied, dest.end() will be called when
      // source gets the 'end' or 'close' events.  Only dest.end() once.
      if (!dest._isStdio && (!options || options.end !== false)) {
        source.on('end', onend);
        source.on('close', onclose);
      }

      var didOnEnd = false;
      function onend() {
        if (didOnEnd) return;
        didOnEnd = true;

        dest.end();
      }


      function onclose() {
        if (didOnEnd) return;
        didOnEnd = true;

        if (typeof dest.destroy === 'function') dest.destroy();
      }

      // don't leave dangling pipes when there are errors.
      function onerror(er) {
        cleanup();
        if (EventEmitter.listenerCount(this, 'error') === 0) {
          throw er; // Unhandled stream error in pipe.
        }
      }

      source.on('error', onerror);
      dest.on('error', onerror);

      // remove all the event listeners that were added.
      function cleanup() {
        source.removeListener('data', ondata);
        dest.removeListener('drain', ondrain);

        source.removeListener('end', onend);
        source.removeListener('close', onclose);

        source.removeListener('error', onerror);
        dest.removeListener('error', onerror);

        source.removeListener('end', cleanup);
        source.removeListener('close', cleanup);

        dest.removeListener('close', cleanup);
      }

      source.on('end', cleanup);
      source.on('close', cleanup);

      dest.on('close', cleanup);

      dest.emit('pipe', source);

      // Allow for unix-like usage: A.pipe(B).pipe(C)
      return dest;
    };

    var rStates = {
      UNSENT: 0,
      OPENED: 1,
      HEADERS_RECEIVED: 2,
      LOADING: 3,
      DONE: 4
    };
    function IncomingMessage(xhr, response, mode) {
      var self = this;
      Readable.call(self);

      self._mode = mode;
      self.headers = {};
      self.rawHeaders = [];
      self.trailers = {};
      self.rawTrailers = [];

      // Fake the 'close' event, but only once 'end' fires
      self.on('end', function() {
        // The nextTick is necessary to prevent the 'request' module from causing an infinite loop
        nextTick(function() {
          self.emit('close');
        });
      });
      var read;
      if (mode === 'fetch') {
        self._fetchResponse = response;

        self.url = response.url;
        self.statusCode = response.status;
        self.statusMessage = response.statusText;
          // backwards compatible version of for (<item> of <iterable>):
          // for (var <item>,_i,_it = <iterable>[Symbol.iterator](); <item> = (_i = _it.next()).value,!_i.done;)
        for (var header, _i, _it = response.headers[Symbol.iterator](); header = (_i = _it.next()).value, !_i.done;) {
          self.headers[header[0].toLowerCase()] = header[1];
          self.rawHeaders.push(header[0], header[1]);
        }

        // TODO: this doesn't respect backpressure. Once WritableStream is available, this can be fixed
        var reader = response.body.getReader();

        read = function () {
          reader.read().then(function(result) {
            if (self._destroyed)
              return
            if (result.done) {
              self.push(null);
              return
            }
            self.push(new Buffer(result.value));
            read();
          });
        };
        read();

      } else {
        self._xhr = xhr;
        self._pos = 0;

        self.url = xhr.responseURL;
        self.statusCode = xhr.status;
        self.statusMessage = xhr.statusText;
        var headers = xhr.getAllResponseHeaders().split(/\r?\n/);
        headers.forEach(function(header) {
          var matches = header.match(/^([^:]+):\s*(.*)/);
          if (matches) {
            var key = matches[1].toLowerCase();
            if (key === 'set-cookie') {
              if (self.headers[key] === undefined) {
                self.headers[key] = [];
              }
              self.headers[key].push(matches[2]);
            } else if (self.headers[key] !== undefined) {
              self.headers[key] += ', ' + matches[2];
            } else {
              self.headers[key] = matches[2];
            }
            self.rawHeaders.push(matches[1], matches[2]);
          }
        });

        self._charset = 'x-user-defined';
        if (!overrideMimeType) {
          var mimeType = self.rawHeaders['mime-type'];
          if (mimeType) {
            var charsetMatch = mimeType.match(/;\s*charset=([^;])(;|$)/);
            if (charsetMatch) {
              self._charset = charsetMatch[1].toLowerCase();
            }
          }
          if (!self._charset)
            self._charset = 'utf-8'; // best guess
        }
      }
    }

    inherits$1(IncomingMessage, Readable);

    IncomingMessage.prototype._read = function() {};

    IncomingMessage.prototype._onXHRProgress = function() {
      var self = this;

      var xhr = self._xhr;

      var response = null;
      switch (self._mode) {
      case 'text:vbarray': // For IE9
        if (xhr.readyState !== rStates.DONE)
          break
        try {
          // This fails in IE8
          response = new global$1.VBArray(xhr.responseBody).toArray();
        } catch (e) {
          // pass
        }
        if (response !== null) {
          self.push(new Buffer(response));
          break
        }
        // Falls through in IE8
      case 'text':
        try { // This will fail when readyState = 3 in IE9. Switch mode and wait for readyState = 4
          response = xhr.responseText;
        } catch (e) {
          self._mode = 'text:vbarray';
          break
        }
        if (response.length > self._pos) {
          var newData = response.substr(self._pos);
          if (self._charset === 'x-user-defined') {
            var buffer = new Buffer(newData.length);
            for (var i = 0; i < newData.length; i++)
              buffer[i] = newData.charCodeAt(i) & 0xff;

            self.push(buffer);
          } else {
            self.push(newData, self._charset);
          }
          self._pos = response.length;
        }
        break
      case 'arraybuffer':
        if (xhr.readyState !== rStates.DONE || !xhr.response)
          break
        response = xhr.response;
        self.push(new Buffer(new Uint8Array(response)));
        break
      case 'moz-chunked-arraybuffer': // take whole
        response = xhr.response;
        if (xhr.readyState !== rStates.LOADING || !response)
          break
        self.push(new Buffer(new Uint8Array(response)));
        break
      case 'ms-stream':
        response = xhr.response;
        if (xhr.readyState !== rStates.LOADING)
          break
        var reader = new global$1.MSStreamReader();
        reader.onprogress = function() {
          if (reader.result.byteLength > self._pos) {
            self.push(new Buffer(new Uint8Array(reader.result.slice(self._pos))));
            self._pos = reader.result.byteLength;
          }
        };
        reader.onload = function() {
          self.push(null);
        };
          // reader.onerror = ??? // TODO: this
        reader.readAsArrayBuffer(response);
        break
      }

      // The ms-stream case handles end separately in reader.onload()
      if (self._xhr.readyState === rStates.DONE && self._mode !== 'ms-stream') {
        self.push(null);
      }
    };

    // from https://github.com/jhiesey/to-arraybuffer/blob/6502d9850e70ba7935a7df4ad86b358fc216f9f0/index.js
    function toArrayBuffer (buf) {
      // If the buffer is backed by a Uint8Array, a faster version will work
      if (buf instanceof Uint8Array) {
        // If the buffer isn't a subarray, return the underlying ArrayBuffer
        if (buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) {
          return buf.buffer
        } else if (typeof buf.buffer.slice === 'function') {
          // Otherwise we need to get a proper copy
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
        }
      }

      if (isBuffer(buf)) {
        // This is the slow version that will work with any Buffer
        // implementation (even in old browsers)
        var arrayCopy = new Uint8Array(buf.length);
        var len = buf.length;
        for (var i = 0; i < len; i++) {
          arrayCopy[i] = buf[i];
        }
        return arrayCopy.buffer
      } else {
        throw new Error('Argument must be a Buffer')
      }
    }

    function decideMode(preferBinary, useFetch) {
      if (hasFetch && useFetch) {
        return 'fetch'
      } else if (mozchunkedarraybuffer) {
        return 'moz-chunked-arraybuffer'
      } else if (msstream) {
        return 'ms-stream'
      } else if (arraybuffer && preferBinary) {
        return 'arraybuffer'
      } else if (vbArray && preferBinary) {
        return 'text:vbarray'
      } else {
        return 'text'
      }
    }

    function ClientRequest(opts) {
      var self = this;
      Writable.call(self);

      self._opts = opts;
      self._body = [];
      self._headers = {};
      if (opts.auth)
        self.setHeader('Authorization', 'Basic ' + new Buffer(opts.auth).toString('base64'));
      Object.keys(opts.headers).forEach(function(name) {
        self.setHeader(name, opts.headers[name]);
      });

      var preferBinary;
      var useFetch = true;
      if (opts.mode === 'disable-fetch') {
        // If the use of XHR should be preferred and includes preserving the 'content-type' header
        useFetch = false;
        preferBinary = true;
      } else if (opts.mode === 'prefer-streaming') {
        // If streaming is a high priority but binary compatibility and
        // the accuracy of the 'content-type' header aren't
        preferBinary = false;
      } else if (opts.mode === 'allow-wrong-content-type') {
        // If streaming is more important than preserving the 'content-type' header
        preferBinary = !overrideMimeType;
      } else if (!opts.mode || opts.mode === 'default' || opts.mode === 'prefer-fast') {
        // Use binary if text streaming may corrupt data or the content-type header, or for speed
        preferBinary = true;
      } else {
        throw new Error('Invalid value for opts.mode')
      }
      self._mode = decideMode(preferBinary, useFetch);

      self.on('finish', function() {
        self._onFinish();
      });
    }

    inherits$1(ClientRequest, Writable);
    // Taken from http://www.w3.org/TR/XMLHttpRequest/#the-setrequestheader%28%29-method
    var unsafeHeaders = [
      'accept-charset',
      'accept-encoding',
      'access-control-request-headers',
      'access-control-request-method',
      'connection',
      'content-length',
      'cookie',
      'cookie2',
      'date',
      'dnt',
      'expect',
      'host',
      'keep-alive',
      'origin',
      'referer',
      'te',
      'trailer',
      'transfer-encoding',
      'upgrade',
      'user-agent',
      'via'
    ];
    ClientRequest.prototype.setHeader = function(name, value) {
      var self = this;
      var lowerName = name.toLowerCase();
        // This check is not necessary, but it prevents warnings from browsers about setting unsafe
        // headers. To be honest I'm not entirely sure hiding these warnings is a good thing, but
        // http-browserify did it, so I will too.
      if (unsafeHeaders.indexOf(lowerName) !== -1)
        return

      self._headers[lowerName] = {
        name: name,
        value: value
      };
    };

    ClientRequest.prototype.getHeader = function(name) {
      var self = this;
      return self._headers[name.toLowerCase()].value
    };

    ClientRequest.prototype.removeHeader = function(name) {
      var self = this;
      delete self._headers[name.toLowerCase()];
    };

    ClientRequest.prototype._onFinish = function() {
      var self = this;

      if (self._destroyed)
        return
      var opts = self._opts;

      var headersObj = self._headers;
      var body;
      if (opts.method === 'POST' || opts.method === 'PUT' || opts.method === 'PATCH') {
        if (blobConstructor()) {
          body = new global$1.Blob(self._body.map(function(buffer) {
            return toArrayBuffer(buffer)
          }), {
            type: (headersObj['content-type'] || {}).value || ''
          });
        } else {
          // get utf8 string
          body = Buffer.concat(self._body).toString();
        }
      }

      if (self._mode === 'fetch') {
        var headers = Object.keys(headersObj).map(function(name) {
          return [headersObj[name].name, headersObj[name].value]
        });

        global$1.fetch(self._opts.url, {
          method: self._opts.method,
          headers: headers,
          body: body,
          mode: 'cors',
          credentials: opts.withCredentials ? 'include' : 'same-origin'
        }).then(function(response) {
          self._fetchResponse = response;
          self._connect();
        }, function(reason) {
          self.emit('error', reason);
        });
      } else {
        var xhr = self._xhr = new global$1.XMLHttpRequest();
        try {
          xhr.open(self._opts.method, self._opts.url, true);
        } catch (err) {
          nextTick(function() {
            self.emit('error', err);
          });
          return
        }

        // Can't set responseType on really old browsers
        if ('responseType' in xhr)
          xhr.responseType = self._mode.split(':')[0];

        if ('withCredentials' in xhr)
          xhr.withCredentials = !!opts.withCredentials;

        if (self._mode === 'text' && 'overrideMimeType' in xhr)
          xhr.overrideMimeType('text/plain; charset=x-user-defined');

        Object.keys(headersObj).forEach(function(name) {
          xhr.setRequestHeader(headersObj[name].name, headersObj[name].value);
        });

        self._response = null;
        xhr.onreadystatechange = function() {
          switch (xhr.readyState) {
          case rStates.LOADING:
          case rStates.DONE:
            self._onXHRProgress();
            break
          }
        };
          // Necessary for streaming in Firefox, since xhr.response is ONLY defined
          // in onprogress, not in onreadystatechange with xhr.readyState = 3
        if (self._mode === 'moz-chunked-arraybuffer') {
          xhr.onprogress = function() {
            self._onXHRProgress();
          };
        }

        xhr.onerror = function() {
          if (self._destroyed)
            return
          self.emit('error', new Error('XHR error'));
        };

        try {
          xhr.send(body);
        } catch (err) {
          nextTick(function() {
            self.emit('error', err);
          });
          return
        }
      }
    };

    /**
     * Checks if xhr.status is readable and non-zero, indicating no error.
     * Even though the spec says it should be available in readyState 3,
     * accessing it throws an exception in IE8
     */
    function statusValid(xhr) {
      try {
        var status = xhr.status;
        return (status !== null && status !== 0)
      } catch (e) {
        return false
      }
    }

    ClientRequest.prototype._onXHRProgress = function() {
      var self = this;

      if (!statusValid(self._xhr) || self._destroyed)
        return

      if (!self._response)
        self._connect();

      self._response._onXHRProgress();
    };

    ClientRequest.prototype._connect = function() {
      var self = this;

      if (self._destroyed)
        return

      self._response = new IncomingMessage(self._xhr, self._fetchResponse, self._mode);
      self.emit('response', self._response);
    };

    ClientRequest.prototype._write = function(chunk, encoding, cb) {
      var self = this;

      self._body.push(chunk);
      cb();
    };

    ClientRequest.prototype.abort = ClientRequest.prototype.destroy = function() {
      var self = this;
      self._destroyed = true;
      if (self._response)
        self._response._destroyed = true;
      if (self._xhr)
        self._xhr.abort();
        // Currently, there isn't a way to truly abort a fetch.
        // If you like bikeshedding, see https://github.com/whatwg/fetch/issues/27
    };

    ClientRequest.prototype.end = function(data, encoding, cb) {
      var self = this;
      if (typeof data === 'function') {
        cb = data;
        data = undefined;
      }

      Writable.prototype.end.call(self, data, encoding, cb);
    };

    ClientRequest.prototype.flushHeaders = function() {};
    ClientRequest.prototype.setTimeout = function() {};
    ClientRequest.prototype.setNoDelay = function() {};
    ClientRequest.prototype.setSocketKeepAlive = function() {};

    /*! https://mths.be/punycode v1.4.1 by @mathias */


    /** Highest positive signed 32-bit float value */
    var maxInt = 2147483647; // aka. 0x7FFFFFFF or 2^31-1

    /** Bootstring parameters */
    var base = 36;
    var tMin = 1;
    var tMax = 26;
    var skew = 38;
    var damp = 700;
    var initialBias = 72;
    var initialN = 128; // 0x80
    var delimiter = '-'; // '\x2D'
    var regexNonASCII = /[^\x20-\x7E]/; // unprintable ASCII chars + non-ASCII chars
    var regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g; // RFC 3490 separators

    /** Error messages */
    var errors = {
      'overflow': 'Overflow: input needs wider integers to process',
      'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
      'invalid-input': 'Invalid input'
    };

    /** Convenience shortcuts */
    var baseMinusTMin = base - tMin;
    var floor = Math.floor;
    var stringFromCharCode = String.fromCharCode;

    /*--------------------------------------------------------------------------*/

    /**
     * A generic error utility function.
     * @private
     * @param {String} type The error type.
     * @returns {Error} Throws a `RangeError` with the applicable error message.
     */
    function error(type) {
      throw new RangeError(errors[type]);
    }

    /**
     * A generic `Array#map` utility function.
     * @private
     * @param {Array} array The array to iterate over.
     * @param {Function} callback The function that gets called for every array
     * item.
     * @returns {Array} A new array of values returned by the callback function.
     */
    function map(array, fn) {
      var length = array.length;
      var result = [];
      while (length--) {
        result[length] = fn(array[length]);
      }
      return result;
    }

    /**
     * A simple `Array#map`-like wrapper to work with domain name strings or email
     * addresses.
     * @private
     * @param {String} domain The domain name or email address.
     * @param {Function} callback The function that gets called for every
     * character.
     * @returns {Array} A new string of characters returned by the callback
     * function.
     */
    function mapDomain(string, fn) {
      var parts = string.split('@');
      var result = '';
      if (parts.length > 1) {
        // In email addresses, only the domain name should be punycoded. Leave
        // the local part (i.e. everything up to `@`) intact.
        result = parts[0] + '@';
        string = parts[1];
      }
      // Avoid `split(regex)` for IE8 compatibility. See #17.
      string = string.replace(regexSeparators, '\x2E');
      var labels = string.split('.');
      var encoded = map(labels, fn).join('.');
      return result + encoded;
    }

    /**
     * Creates an array containing the numeric code points of each Unicode
     * character in the string. While JavaScript uses UCS-2 internally,
     * this function will convert a pair of surrogate halves (each of which
     * UCS-2 exposes as separate characters) into a single code point,
     * matching UTF-16.
     * @see `punycode.ucs2.encode`
     * @see <https://mathiasbynens.be/notes/javascript-encoding>
     * @memberOf punycode.ucs2
     * @name decode
     * @param {String} string The Unicode input string (UCS-2).
     * @returns {Array} The new array of code points.
     */
    function ucs2decode(string) {
      var output = [],
        counter = 0,
        length = string.length,
        value,
        extra;
      while (counter < length) {
        value = string.charCodeAt(counter++);
        if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
          // high surrogate, and there is a next character
          extra = string.charCodeAt(counter++);
          if ((extra & 0xFC00) == 0xDC00) { // low surrogate
            output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
          } else {
            // unmatched surrogate; only append this code unit, in case the next
            // code unit is the high surrogate of a surrogate pair
            output.push(value);
            counter--;
          }
        } else {
          output.push(value);
        }
      }
      return output;
    }

    /**
     * Converts a digit/integer into a basic code point.
     * @see `basicToDigit()`
     * @private
     * @param {Number} digit The numeric value of a basic code point.
     * @returns {Number} The basic code point whose value (when used for
     * representing integers) is `digit`, which needs to be in the range
     * `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
     * used; else, the lowercase form is used. The behavior is undefined
     * if `flag` is non-zero and `digit` has no uppercase form.
     */
    function digitToBasic(digit, flag) {
      //  0..25 map to ASCII a..z or A..Z
      // 26..35 map to ASCII 0..9
      return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
    }

    /**
     * Bias adaptation function as per section 3.4 of RFC 3492.
     * https://tools.ietf.org/html/rfc3492#section-3.4
     * @private
     */
    function adapt(delta, numPoints, firstTime) {
      var k = 0;
      delta = firstTime ? floor(delta / damp) : delta >> 1;
      delta += floor(delta / numPoints);
      for ( /* no initialization */ ; delta > baseMinusTMin * tMax >> 1; k += base) {
        delta = floor(delta / baseMinusTMin);
      }
      return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
    }

    /**
     * Converts a string of Unicode symbols (e.g. a domain name label) to a
     * Punycode string of ASCII-only symbols.
     * @memberOf punycode
     * @param {String} input The string of Unicode symbols.
     * @returns {String} The resulting Punycode string of ASCII-only symbols.
     */
    function encode(input) {
      var n,
        delta,
        handledCPCount,
        basicLength,
        bias,
        j,
        m,
        q,
        k,
        t,
        currentValue,
        output = [],
        /** `inputLength` will hold the number of code points in `input`. */
        inputLength,
        /** Cached calculation results */
        handledCPCountPlusOne,
        baseMinusT,
        qMinusT;

      // Convert the input in UCS-2 to Unicode
      input = ucs2decode(input);

      // Cache the length
      inputLength = input.length;

      // Initialize the state
      n = initialN;
      delta = 0;
      bias = initialBias;

      // Handle the basic code points
      for (j = 0; j < inputLength; ++j) {
        currentValue = input[j];
        if (currentValue < 0x80) {
          output.push(stringFromCharCode(currentValue));
        }
      }

      handledCPCount = basicLength = output.length;

      // `handledCPCount` is the number of code points that have been handled;
      // `basicLength` is the number of basic code points.

      // Finish the basic string - if it is not empty - with a delimiter
      if (basicLength) {
        output.push(delimiter);
      }

      // Main encoding loop:
      while (handledCPCount < inputLength) {

        // All non-basic code points < n have been handled already. Find the next
        // larger one:
        for (m = maxInt, j = 0; j < inputLength; ++j) {
          currentValue = input[j];
          if (currentValue >= n && currentValue < m) {
            m = currentValue;
          }
        }

        // Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
        // but guard against overflow
        handledCPCountPlusOne = handledCPCount + 1;
        if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
          error('overflow');
        }

        delta += (m - n) * handledCPCountPlusOne;
        n = m;

        for (j = 0; j < inputLength; ++j) {
          currentValue = input[j];

          if (currentValue < n && ++delta > maxInt) {
            error('overflow');
          }

          if (currentValue == n) {
            // Represent delta as a generalized variable-length integer
            for (q = delta, k = base; /* no condition */ ; k += base) {
              t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
              if (q < t) {
                break;
              }
              qMinusT = q - t;
              baseMinusT = base - t;
              output.push(
                stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
              );
              q = floor(qMinusT / baseMinusT);
            }

            output.push(stringFromCharCode(digitToBasic(q, 0)));
            bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
            delta = 0;
            ++handledCPCount;
          }
        }

        ++delta;
        ++n;

      }
      return output.join('');
    }

    /**
     * Converts a Unicode string representing a domain name or an email address to
     * Punycode. Only the non-ASCII parts of the domain name will be converted,
     * i.e. it doesn't matter if you call it with a domain that's already in
     * ASCII.
     * @memberOf punycode
     * @param {String} input The domain name or email address to convert, as a
     * Unicode string.
     * @returns {String} The Punycode representation of the given domain name or
     * email address.
     */
    function toASCII(input) {
      return mapDomain(input, function(string) {
        return regexNonASCII.test(string) ?
          'xn--' + encode(string) :
          string;
      });
    }

    // Copyright Joyent, Inc. and other Node contributors.
    //
    // Permission is hereby granted, free of charge, to any person obtaining a
    // copy of this software and associated documentation files (the
    // "Software"), to deal in the Software without restriction, including
    // without limitation the rights to use, copy, modify, merge, publish,
    // distribute, sublicense, and/or sell copies of the Software, and to permit
    // persons to whom the Software is furnished to do so, subject to the
    // following conditions:
    //
    // The above copyright notice and this permission notice shall be included
    // in all copies or substantial portions of the Software.
    //
    // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
    // OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
    // MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
    // NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
    // DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
    // OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
    // USE OR OTHER DEALINGS IN THE SOFTWARE.


    // If obj.hasOwnProperty has been overridden, then calling
    // obj.hasOwnProperty(prop) will break.
    // See: https://github.com/joyent/node/issues/1707
    function hasOwnProperty$1(obj, prop) {
      return Object.prototype.hasOwnProperty.call(obj, prop);
    }
    var isArray$2 = Array.isArray || function (xs) {
      return Object.prototype.toString.call(xs) === '[object Array]';
    };
    function stringifyPrimitive(v) {
      switch (typeof v) {
        case 'string':
          return v;

        case 'boolean':
          return v ? 'true' : 'false';

        case 'number':
          return isFinite(v) ? v : '';

        default:
          return '';
      }
    }

    function stringify (obj, sep, eq, name) {
      sep = sep || '&';
      eq = eq || '=';
      if (obj === null) {
        obj = undefined;
      }

      if (typeof obj === 'object') {
        return map$1(objectKeys(obj), function(k) {
          var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
          if (isArray$2(obj[k])) {
            return map$1(obj[k], function(v) {
              return ks + encodeURIComponent(stringifyPrimitive(v));
            }).join(sep);
          } else {
            return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
          }
        }).join(sep);

      }

      if (!name) return '';
      return encodeURIComponent(stringifyPrimitive(name)) + eq +
             encodeURIComponent(stringifyPrimitive(obj));
    }
    function map$1 (xs, f) {
      if (xs.map) return xs.map(f);
      var res = [];
      for (var i = 0; i < xs.length; i++) {
        res.push(f(xs[i], i));
      }
      return res;
    }

    var objectKeys = Object.keys || function (obj) {
      var res = [];
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
      }
      return res;
    };

    function parse(qs, sep, eq, options) {
      sep = sep || '&';
      eq = eq || '=';
      var obj = {};

      if (typeof qs !== 'string' || qs.length === 0) {
        return obj;
      }

      var regexp = /\+/g;
      qs = qs.split(sep);

      var maxKeys = 1000;
      if (options && typeof options.maxKeys === 'number') {
        maxKeys = options.maxKeys;
      }

      var len = qs.length;
      // maxKeys <= 0 means that we should not limit keys count
      if (maxKeys > 0 && len > maxKeys) {
        len = maxKeys;
      }

      for (var i = 0; i < len; ++i) {
        var x = qs[i].replace(regexp, '%20'),
            idx = x.indexOf(eq),
            kstr, vstr, k, v;

        if (idx >= 0) {
          kstr = x.substr(0, idx);
          vstr = x.substr(idx + 1);
        } else {
          kstr = x;
          vstr = '';
        }

        k = decodeURIComponent(kstr);
        v = decodeURIComponent(vstr);

        if (!hasOwnProperty$1(obj, k)) {
          obj[k] = v;
        } else if (isArray$2(obj[k])) {
          obj[k].push(v);
        } else {
          obj[k] = [obj[k], v];
        }
      }

      return obj;
    }

    // Copyright Joyent, Inc. and other Node contributors.
    var url = {
      parse: urlParse,
      resolve: urlResolve,
      resolveObject: urlResolveObject,
      format: urlFormat,
      Url: Url
    };
    function Url() {
      this.protocol = null;
      this.slashes = null;
      this.auth = null;
      this.host = null;
      this.port = null;
      this.hostname = null;
      this.hash = null;
      this.search = null;
      this.query = null;
      this.pathname = null;
      this.path = null;
      this.href = null;
    }

    // Reference: RFC 3986, RFC 1808, RFC 2396

    // define these here so at least they only have to be
    // compiled once on the first module load.
    var protocolPattern = /^([a-z0-9.+-]+:)/i,
      portPattern = /:[0-9]*$/,

      // Special case for a simple path URL
      simplePathPattern = /^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/,

      // RFC 2396: characters reserved for delimiting URLs.
      // We actually just auto-escape these.
      delims = ['<', '>', '"', '`', ' ', '\r', '\n', '\t'],

      // RFC 2396: characters not allowed for various reasons.
      unwise = ['{', '}', '|', '\\', '^', '`'].concat(delims),

      // Allowed by RFCs, but cause of XSS attacks.  Always escape these.
      autoEscape = ['\''].concat(unwise),
      // Characters that are never ever allowed in a hostname.
      // Note that any invalid chars are also handled, but these
      // are the ones that are *expected* to be seen, so we fast-path
      // them.
      nonHostChars = ['%', '/', '?', ';', '#'].concat(autoEscape),
      hostEndingChars = ['/', '?', '#'],
      hostnameMaxLen = 255,
      hostnamePartPattern = /^[+a-z0-9A-Z_-]{0,63}$/,
      hostnamePartStart = /^([+a-z0-9A-Z_-]{0,63})(.*)$/,
      // protocols that can allow "unsafe" and "unwise" chars.
      unsafeProtocol = {
        'javascript': true,
        'javascript:': true
      },
      // protocols that never have a hostname.
      hostlessProtocol = {
        'javascript': true,
        'javascript:': true
      },
      // protocols that always contain a // bit.
      slashedProtocol = {
        'http': true,
        'https': true,
        'ftp': true,
        'gopher': true,
        'file': true,
        'http:': true,
        'https:': true,
        'ftp:': true,
        'gopher:': true,
        'file:': true
      };

    function urlParse(url, parseQueryString, slashesDenoteHost) {
      if (url && isObject(url) && url instanceof Url) return url;

      var u = new Url;
      u.parse(url, parseQueryString, slashesDenoteHost);
      return u;
    }
    Url.prototype.parse = function(url, parseQueryString, slashesDenoteHost) {
      return parse$1(this, url, parseQueryString, slashesDenoteHost);
    };

    function parse$1(self, url, parseQueryString, slashesDenoteHost) {
      if (!isString(url)) {
        throw new TypeError('Parameter \'url\' must be a string, not ' + typeof url);
      }

      // Copy chrome, IE, opera backslash-handling behavior.
      // Back slashes before the query string get converted to forward slashes
      // See: https://code.google.com/p/chromium/issues/detail?id=25916
      var queryIndex = url.indexOf('?'),
        splitter =
        (queryIndex !== -1 && queryIndex < url.indexOf('#')) ? '?' : '#',
        uSplit = url.split(splitter),
        slashRegex = /\\/g;
      uSplit[0] = uSplit[0].replace(slashRegex, '/');
      url = uSplit.join(splitter);

      var rest = url;

      // trim before proceeding.
      // This is to support parse stuff like "  http://foo.com  \n"
      rest = rest.trim();

      if (!slashesDenoteHost && url.split('#').length === 1) {
        // Try fast path regexp
        var simplePath = simplePathPattern.exec(rest);
        if (simplePath) {
          self.path = rest;
          self.href = rest;
          self.pathname = simplePath[1];
          if (simplePath[2]) {
            self.search = simplePath[2];
            if (parseQueryString) {
              self.query = parse(self.search.substr(1));
            } else {
              self.query = self.search.substr(1);
            }
          } else if (parseQueryString) {
            self.search = '';
            self.query = {};
          }
          return self;
        }
      }

      var proto = protocolPattern.exec(rest);
      if (proto) {
        proto = proto[0];
        var lowerProto = proto.toLowerCase();
        self.protocol = lowerProto;
        rest = rest.substr(proto.length);
      }

      // figure out if it's got a host
      // user@server is *always* interpreted as a hostname, and url
      // resolution will treat //foo/bar as host=foo,path=bar because that's
      // how the browser resolves relative URLs.
      if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
        var slashes = rest.substr(0, 2) === '//';
        if (slashes && !(proto && hostlessProtocol[proto])) {
          rest = rest.substr(2);
          self.slashes = true;
        }
      }
      var i, hec, l, p;
      if (!hostlessProtocol[proto] &&
        (slashes || (proto && !slashedProtocol[proto]))) {

        // there's a hostname.
        // the first instance of /, ?, ;, or # ends the host.
        //
        // If there is an @ in the hostname, then non-host chars *are* allowed
        // to the left of the last @ sign, unless some host-ending character
        // comes *before* the @-sign.
        // URLs are obnoxious.
        //
        // ex:
        // http://a@b@c/ => user:a@b host:c
        // http://a@b?@c => user:a host:c path:/?@c

        // v0.12 TODO(isaacs): This is not quite how Chrome does things.
        // Review our test case against browsers more comprehensively.

        // find the first instance of any hostEndingChars
        var hostEnd = -1;
        for (i = 0; i < hostEndingChars.length; i++) {
          hec = rest.indexOf(hostEndingChars[i]);
          if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
            hostEnd = hec;
        }

        // at this point, either we have an explicit point where the
        // auth portion cannot go past, or the last @ char is the decider.
        var auth, atSign;
        if (hostEnd === -1) {
          // atSign can be anywhere.
          atSign = rest.lastIndexOf('@');
        } else {
          // atSign must be in auth portion.
          // http://a@b/c@d => host:b auth:a path:/c@d
          atSign = rest.lastIndexOf('@', hostEnd);
        }

        // Now we have a portion which is definitely the auth.
        // Pull that off.
        if (atSign !== -1) {
          auth = rest.slice(0, atSign);
          rest = rest.slice(atSign + 1);
          self.auth = decodeURIComponent(auth);
        }

        // the host is the remaining to the left of the first non-host char
        hostEnd = -1;
        for (i = 0; i < nonHostChars.length; i++) {
          hec = rest.indexOf(nonHostChars[i]);
          if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
            hostEnd = hec;
        }
        // if we still have not hit it, then the entire thing is a host.
        if (hostEnd === -1)
          hostEnd = rest.length;

        self.host = rest.slice(0, hostEnd);
        rest = rest.slice(hostEnd);

        // pull out port.
        parseHost(self);

        // we've indicated that there is a hostname,
        // so even if it's empty, it has to be present.
        self.hostname = self.hostname || '';

        // if hostname begins with [ and ends with ]
        // assume that it's an IPv6 address.
        var ipv6Hostname = self.hostname[0] === '[' &&
          self.hostname[self.hostname.length - 1] === ']';

        // validate a little.
        if (!ipv6Hostname) {
          var hostparts = self.hostname.split(/\./);
          for (i = 0, l = hostparts.length; i < l; i++) {
            var part = hostparts[i];
            if (!part) continue;
            if (!part.match(hostnamePartPattern)) {
              var newpart = '';
              for (var j = 0, k = part.length; j < k; j++) {
                if (part.charCodeAt(j) > 127) {
                  // we replace non-ASCII char with a temporary placeholder
                  // we need this to make sure size of hostname is not
                  // broken by replacing non-ASCII by nothing
                  newpart += 'x';
                } else {
                  newpart += part[j];
                }
              }
              // we test again with ASCII char only
              if (!newpart.match(hostnamePartPattern)) {
                var validParts = hostparts.slice(0, i);
                var notHost = hostparts.slice(i + 1);
                var bit = part.match(hostnamePartStart);
                if (bit) {
                  validParts.push(bit[1]);
                  notHost.unshift(bit[2]);
                }
                if (notHost.length) {
                  rest = '/' + notHost.join('.') + rest;
                }
                self.hostname = validParts.join('.');
                break;
              }
            }
          }
        }

        if (self.hostname.length > hostnameMaxLen) {
          self.hostname = '';
        } else {
          // hostnames are always lower case.
          self.hostname = self.hostname.toLowerCase();
        }

        if (!ipv6Hostname) {
          // IDNA Support: Returns a punycoded representation of "domain".
          // It only converts parts of the domain name that
          // have non-ASCII characters, i.e. it doesn't matter if
          // you call it with a domain that already is ASCII-only.
          self.hostname = toASCII(self.hostname);
        }

        p = self.port ? ':' + self.port : '';
        var h = self.hostname || '';
        self.host = h + p;
        self.href += self.host;

        // strip [ and ] from the hostname
        // the host field still retains them, though
        if (ipv6Hostname) {
          self.hostname = self.hostname.substr(1, self.hostname.length - 2);
          if (rest[0] !== '/') {
            rest = '/' + rest;
          }
        }
      }

      // now rest is set to the post-host stuff.
      // chop off any delim chars.
      if (!unsafeProtocol[lowerProto]) {

        // First, make 100% sure that any "autoEscape" chars get
        // escaped, even if encodeURIComponent doesn't think they
        // need to be.
        for (i = 0, l = autoEscape.length; i < l; i++) {
          var ae = autoEscape[i];
          if (rest.indexOf(ae) === -1)
            continue;
          var esc = encodeURIComponent(ae);
          if (esc === ae) {
            esc = escape(ae);
          }
          rest = rest.split(ae).join(esc);
        }
      }


      // chop off from the tail first.
      var hash = rest.indexOf('#');
      if (hash !== -1) {
        // got a fragment string.
        self.hash = rest.substr(hash);
        rest = rest.slice(0, hash);
      }
      var qm = rest.indexOf('?');
      if (qm !== -1) {
        self.search = rest.substr(qm);
        self.query = rest.substr(qm + 1);
        if (parseQueryString) {
          self.query = parse(self.query);
        }
        rest = rest.slice(0, qm);
      } else if (parseQueryString) {
        // no query string, but parseQueryString still requested
        self.search = '';
        self.query = {};
      }
      if (rest) self.pathname = rest;
      if (slashedProtocol[lowerProto] &&
        self.hostname && !self.pathname) {
        self.pathname = '/';
      }

      //to support http.request
      if (self.pathname || self.search) {
        p = self.pathname || '';
        var s = self.search || '';
        self.path = p + s;
      }

      // finally, reconstruct the href based on what has been validated.
      self.href = format$1(self);
      return self;
    }

    // format a parsed object into a url string
    function urlFormat(obj) {
      // ensure it's an object, and not a string url.
      // If it's an obj, this is a no-op.
      // this way, you can call url_format() on strings
      // to clean up potentially wonky urls.
      if (isString(obj)) obj = parse$1({}, obj);
      return format$1(obj);
    }

    function format$1(self) {
      var auth = self.auth || '';
      if (auth) {
        auth = encodeURIComponent(auth);
        auth = auth.replace(/%3A/i, ':');
        auth += '@';
      }

      var protocol = self.protocol || '',
        pathname = self.pathname || '',
        hash = self.hash || '',
        host = false,
        query = '';

      if (self.host) {
        host = auth + self.host;
      } else if (self.hostname) {
        host = auth + (self.hostname.indexOf(':') === -1 ?
          self.hostname :
          '[' + this.hostname + ']');
        if (self.port) {
          host += ':' + self.port;
        }
      }

      if (self.query &&
        isObject(self.query) &&
        Object.keys(self.query).length) {
        query = stringify(self.query);
      }

      var search = self.search || (query && ('?' + query)) || '';

      if (protocol && protocol.substr(-1) !== ':') protocol += ':';

      // only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
      // unless they had them to begin with.
      if (self.slashes ||
        (!protocol || slashedProtocol[protocol]) && host !== false) {
        host = '//' + (host || '');
        if (pathname && pathname.charAt(0) !== '/') pathname = '/' + pathname;
      } else if (!host) {
        host = '';
      }

      if (hash && hash.charAt(0) !== '#') hash = '#' + hash;
      if (search && search.charAt(0) !== '?') search = '?' + search;

      pathname = pathname.replace(/[?#]/g, function(match) {
        return encodeURIComponent(match);
      });
      search = search.replace('#', '%23');

      return protocol + host + pathname + search + hash;
    }

    Url.prototype.format = function() {
      return format$1(this);
    };

    function urlResolve(source, relative) {
      return urlParse(source, false, true).resolve(relative);
    }

    Url.prototype.resolve = function(relative) {
      return this.resolveObject(urlParse(relative, false, true)).format();
    };

    function urlResolveObject(source, relative) {
      if (!source) return relative;
      return urlParse(source, false, true).resolveObject(relative);
    }

    Url.prototype.resolveObject = function(relative) {
      if (isString(relative)) {
        var rel = new Url();
        rel.parse(relative, false, true);
        relative = rel;
      }

      var result = new Url();
      var tkeys = Object.keys(this);
      for (var tk = 0; tk < tkeys.length; tk++) {
        var tkey = tkeys[tk];
        result[tkey] = this[tkey];
      }

      // hash is always overridden, no matter what.
      // even href="" will remove it.
      result.hash = relative.hash;

      // if the relative url is empty, then there's nothing left to do here.
      if (relative.href === '') {
        result.href = result.format();
        return result;
      }

      // hrefs like //foo/bar always cut to the protocol.
      if (relative.slashes && !relative.protocol) {
        // take everything except the protocol from relative
        var rkeys = Object.keys(relative);
        for (var rk = 0; rk < rkeys.length; rk++) {
          var rkey = rkeys[rk];
          if (rkey !== 'protocol')
            result[rkey] = relative[rkey];
        }

        //urlParse appends trailing / to urls like http://www.example.com
        if (slashedProtocol[result.protocol] &&
          result.hostname && !result.pathname) {
          result.path = result.pathname = '/';
        }

        result.href = result.format();
        return result;
      }
      var relPath;
      if (relative.protocol && relative.protocol !== result.protocol) {
        // if it's a known url protocol, then changing
        // the protocol does weird things
        // first, if it's not file:, then we MUST have a host,
        // and if there was a path
        // to begin with, then we MUST have a path.
        // if it is file:, then the host is dropped,
        // because that's known to be hostless.
        // anything else is assumed to be absolute.
        if (!slashedProtocol[relative.protocol]) {
          var keys = Object.keys(relative);
          for (var v = 0; v < keys.length; v++) {
            var k = keys[v];
            result[k] = relative[k];
          }
          result.href = result.format();
          return result;
        }

        result.protocol = relative.protocol;
        if (!relative.host && !hostlessProtocol[relative.protocol]) {
          relPath = (relative.pathname || '').split('/');
          while (relPath.length && !(relative.host = relPath.shift()));
          if (!relative.host) relative.host = '';
          if (!relative.hostname) relative.hostname = '';
          if (relPath[0] !== '') relPath.unshift('');
          if (relPath.length < 2) relPath.unshift('');
          result.pathname = relPath.join('/');
        } else {
          result.pathname = relative.pathname;
        }
        result.search = relative.search;
        result.query = relative.query;
        result.host = relative.host || '';
        result.auth = relative.auth;
        result.hostname = relative.hostname || relative.host;
        result.port = relative.port;
        // to support http.request
        if (result.pathname || result.search) {
          var p = result.pathname || '';
          var s = result.search || '';
          result.path = p + s;
        }
        result.slashes = result.slashes || relative.slashes;
        result.href = result.format();
        return result;
      }

      var isSourceAbs = (result.pathname && result.pathname.charAt(0) === '/'),
        isRelAbs = (
          relative.host ||
          relative.pathname && relative.pathname.charAt(0) === '/'
        ),
        mustEndAbs = (isRelAbs || isSourceAbs ||
          (result.host && relative.pathname)),
        removeAllDots = mustEndAbs,
        srcPath = result.pathname && result.pathname.split('/') || [],
        psychotic = result.protocol && !slashedProtocol[result.protocol];
      relPath = relative.pathname && relative.pathname.split('/') || [];
      // if the url is a non-slashed url, then relative
      // links like ../.. should be able
      // to crawl up to the hostname, as well.  This is strange.
      // result.protocol has already been set by now.
      // Later on, put the first path part into the host field.
      if (psychotic) {
        result.hostname = '';
        result.port = null;
        if (result.host) {
          if (srcPath[0] === '') srcPath[0] = result.host;
          else srcPath.unshift(result.host);
        }
        result.host = '';
        if (relative.protocol) {
          relative.hostname = null;
          relative.port = null;
          if (relative.host) {
            if (relPath[0] === '') relPath[0] = relative.host;
            else relPath.unshift(relative.host);
          }
          relative.host = null;
        }
        mustEndAbs = mustEndAbs && (relPath[0] === '' || srcPath[0] === '');
      }
      var authInHost;
      if (isRelAbs) {
        // it's absolute.
        result.host = (relative.host || relative.host === '') ?
          relative.host : result.host;
        result.hostname = (relative.hostname || relative.hostname === '') ?
          relative.hostname : result.hostname;
        result.search = relative.search;
        result.query = relative.query;
        srcPath = relPath;
        // fall through to the dot-handling below.
      } else if (relPath.length) {
        // it's relative
        // throw away the existing file, and take the new path instead.
        if (!srcPath) srcPath = [];
        srcPath.pop();
        srcPath = srcPath.concat(relPath);
        result.search = relative.search;
        result.query = relative.query;
      } else if (!isNullOrUndefined(relative.search)) {
        // just pull out the search.
        // like href='?foo'.
        // Put this after the other two cases because it simplifies the booleans
        if (psychotic) {
          result.hostname = result.host = srcPath.shift();
          //occationaly the auth can get stuck only in host
          //this especially happens in cases like
          //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
          authInHost = result.host && result.host.indexOf('@') > 0 ?
            result.host.split('@') : false;
          if (authInHost) {
            result.auth = authInHost.shift();
            result.host = result.hostname = authInHost.shift();
          }
        }
        result.search = relative.search;
        result.query = relative.query;
        //to support http.request
        if (!isNull(result.pathname) || !isNull(result.search)) {
          result.path = (result.pathname ? result.pathname : '') +
            (result.search ? result.search : '');
        }
        result.href = result.format();
        return result;
      }

      if (!srcPath.length) {
        // no path at all.  easy.
        // we've already handled the other stuff above.
        result.pathname = null;
        //to support http.request
        if (result.search) {
          result.path = '/' + result.search;
        } else {
          result.path = null;
        }
        result.href = result.format();
        return result;
      }

      // if a url ENDs in . or .., then it must get a trailing slash.
      // however, if it ends in anything else non-slashy,
      // then it must NOT get a trailing slash.
      var last = srcPath.slice(-1)[0];
      var hasTrailingSlash = (
        (result.host || relative.host || srcPath.length > 1) &&
        (last === '.' || last === '..') || last === '');

      // strip single dots, resolve double dots to parent dir
      // if the path tries to go above the root, `up` ends up > 0
      var up = 0;
      for (var i = srcPath.length; i >= 0; i--) {
        last = srcPath[i];
        if (last === '.') {
          srcPath.splice(i, 1);
        } else if (last === '..') {
          srcPath.splice(i, 1);
          up++;
        } else if (up) {
          srcPath.splice(i, 1);
          up--;
        }
      }

      // if the path is allowed to go above the root, restore leading ..s
      if (!mustEndAbs && !removeAllDots) {
        for (; up--; up) {
          srcPath.unshift('..');
        }
      }

      if (mustEndAbs && srcPath[0] !== '' &&
        (!srcPath[0] || srcPath[0].charAt(0) !== '/')) {
        srcPath.unshift('');
      }

      if (hasTrailingSlash && (srcPath.join('/').substr(-1) !== '/')) {
        srcPath.push('');
      }

      var isAbsolute = srcPath[0] === '' ||
        (srcPath[0] && srcPath[0].charAt(0) === '/');

      // put the host back
      if (psychotic) {
        result.hostname = result.host = isAbsolute ? '' :
          srcPath.length ? srcPath.shift() : '';
        //occationaly the auth can get stuck only in host
        //this especially happens in cases like
        //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
        authInHost = result.host && result.host.indexOf('@') > 0 ?
          result.host.split('@') : false;
        if (authInHost) {
          result.auth = authInHost.shift();
          result.host = result.hostname = authInHost.shift();
        }
      }

      mustEndAbs = mustEndAbs || (result.host && srcPath.length);

      if (mustEndAbs && !isAbsolute) {
        srcPath.unshift('');
      }

      if (!srcPath.length) {
        result.pathname = null;
        result.path = null;
      } else {
        result.pathname = srcPath.join('/');
      }

      //to support request.http
      if (!isNull(result.pathname) || !isNull(result.search)) {
        result.path = (result.pathname ? result.pathname : '') +
          (result.search ? result.search : '');
      }
      result.auth = relative.auth || result.auth;
      result.slashes = result.slashes || relative.slashes;
      result.href = result.format();
      return result;
    };

    Url.prototype.parseHost = function() {
      return parseHost(this);
    };

    function parseHost(self) {
      var host = self.host;
      var port = portPattern.exec(host);
      if (port) {
        port = port[0];
        if (port !== ':') {
          self.port = port.substr(1);
        }
        host = host.substr(0, host.length - port.length);
      }
      if (host) self.hostname = host;
    }

    function request(opts, cb) {
      if (typeof opts === 'string')
        opts = urlParse(opts);


      // Normally, the page is loaded from http or https, so not specifying a protocol
      // will result in a (valid) protocol-relative url. However, this won't work if
      // the protocol is something else, like 'file:'
      var defaultProtocol = global$1.location.protocol.search(/^https?:$/) === -1 ? 'http:' : '';

      var protocol = opts.protocol || defaultProtocol;
      var host = opts.hostname || opts.host;
      var port = opts.port;
      var path = opts.path || '/';

      // Necessary for IPv6 addresses
      if (host && host.indexOf(':') !== -1)
        host = '[' + host + ']';

      // This may be a relative url. The browser should always be able to interpret it correctly.
      opts.url = (host ? (protocol + '//' + host) : '') + (port ? ':' + port : '') + path;
      opts.method = (opts.method || 'GET').toUpperCase();
      opts.headers = opts.headers || {};

      // Also valid opts.auth, opts.mode

      var req = new ClientRequest(opts);
      if (cb)
        req.on('response', cb);
      return req
    }

    function get(opts, cb) {
      var req = request(opts, cb);
      req.end();
      return req
    }

    function Agent() {}
    Agent.defaultMaxSockets = 4;

    var METHODS = [
      'CHECKOUT',
      'CONNECT',
      'COPY',
      'DELETE',
      'GET',
      'HEAD',
      'LOCK',
      'M-SEARCH',
      'MERGE',
      'MKACTIVITY',
      'MKCOL',
      'MOVE',
      'NOTIFY',
      'OPTIONS',
      'PATCH',
      'POST',
      'PROPFIND',
      'PROPPATCH',
      'PURGE',
      'PUT',
      'REPORT',
      'SEARCH',
      'SUBSCRIBE',
      'TRACE',
      'UNLOCK',
      'UNSUBSCRIBE'
    ];
    var STATUS_CODES = {
      100: 'Continue',
      101: 'Switching Protocols',
      102: 'Processing', // RFC 2518, obsoleted by RFC 4918
      200: 'OK',
      201: 'Created',
      202: 'Accepted',
      203: 'Non-Authoritative Information',
      204: 'No Content',
      205: 'Reset Content',
      206: 'Partial Content',
      207: 'Multi-Status', // RFC 4918
      300: 'Multiple Choices',
      301: 'Moved Permanently',
      302: 'Moved Temporarily',
      303: 'See Other',
      304: 'Not Modified',
      305: 'Use Proxy',
      307: 'Temporary Redirect',
      400: 'Bad Request',
      401: 'Unauthorized',
      402: 'Payment Required',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      406: 'Not Acceptable',
      407: 'Proxy Authentication Required',
      408: 'Request Time-out',
      409: 'Conflict',
      410: 'Gone',
      411: 'Length Required',
      412: 'Precondition Failed',
      413: 'Request Entity Too Large',
      414: 'Request-URI Too Large',
      415: 'Unsupported Media Type',
      416: 'Requested Range Not Satisfiable',
      417: 'Expectation Failed',
      418: 'I\'m a teapot', // RFC 2324
      422: 'Unprocessable Entity', // RFC 4918
      423: 'Locked', // RFC 4918
      424: 'Failed Dependency', // RFC 4918
      425: 'Unordered Collection', // RFC 4918
      426: 'Upgrade Required', // RFC 2817
      428: 'Precondition Required', // RFC 6585
      429: 'Too Many Requests', // RFC 6585
      431: 'Request Header Fields Too Large', // RFC 6585
      500: 'Internal Server Error',
      501: 'Not Implemented',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Time-out',
      505: 'HTTP Version Not Supported',
      506: 'Variant Also Negotiates', // RFC 2295
      507: 'Insufficient Storage', // RFC 4918
      509: 'Bandwidth Limit Exceeded',
      510: 'Not Extended', // RFC 2774
      511: 'Network Authentication Required' // RFC 6585
    };

    var http = {
      request,
      get,
      Agent,
      METHODS,
      STATUS_CODES
    };

    var lib = createCommonjsModule(function (module, exports) {
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.NodeHttpTransport = void 0;




    function NodeHttpTransport() {
        return function (opts) {
            return new NodeHttp(opts);
        };
    }
    exports.NodeHttpTransport = NodeHttpTransport;
    var NodeHttp = (function () {
        function NodeHttp(transportOptions) {
            this.options = transportOptions;
        }
        NodeHttp.prototype.sendMessage = function (msgBytes) {
            if (!this.options.methodDefinition.requestStream && !this.options.methodDefinition.responseStream) {
                this.request.setHeader("Content-Length", msgBytes.byteLength);
            }
            this.request.write(toBuffer(msgBytes));
            this.request.end();
        };
        NodeHttp.prototype.finishSend = function () {
        };
        NodeHttp.prototype.responseCallback = function (response) {
            var _this = this;
            this.options.debug && console.log("NodeHttp.response", response.statusCode);
            var headers = filterHeadersForUndefined(response.headers);
            this.options.onHeaders(new grpcWebClient.grpc.Metadata(headers), response.statusCode);
            response.on("data", function (chunk) {
                _this.options.debug && console.log("NodeHttp.data", chunk);
                _this.options.onChunk(toArrayBuffer(chunk));
            });
            response.on("end", function () {
                _this.options.debug && console.log("NodeHttp.end");
                _this.options.onEnd();
            });
        };
        NodeHttp.prototype.start = function (metadata) {
            var _this = this;
            var headers = {};
            metadata.forEach(function (key, values) {
                headers[key] = values.join(", ");
            });
            var parsedUrl = url.parse(this.options.url);
            var httpOptions = {
                host: parsedUrl.hostname,
                port: parsedUrl.port ? parseInt(parsedUrl.port) : undefined,
                path: parsedUrl.path,
                headers: headers,
                method: "POST"
            };
            if (parsedUrl.protocol === "https:") {
                this.request = http.request(httpOptions, this.responseCallback.bind(this));
            }
            else {
                this.request = http.request(httpOptions, this.responseCallback.bind(this));
            }
            this.request.on("error", function (err) {
                _this.options.debug && console.log("NodeHttp.error", err);
                _this.options.onEnd(err);
            });
        };
        NodeHttp.prototype.cancel = function () {
            this.options.debug && console.log("NodeHttp.abort");
            this.request.abort();
        };
        return NodeHttp;
    }());
    function filterHeadersForUndefined(headers) {
        var filteredHeaders = {};
        for (var key in headers) {
            var value = headers[key];
            if (headers.hasOwnProperty(key)) {
                if (value !== undefined) {
                    filteredHeaders[key] = value;
                }
            }
        }
        return filteredHeaders;
    }
    function toArrayBuffer(buf) {
        var view = new Uint8Array(buf.length);
        for (var i = 0; i < buf.length; i++) {
            view[i] = buf[i];
        }
        return view;
    }
    function toBuffer(ab) {
        var buf = Buffer.alloc(ab.byteLength);
        for (var i = 0; i < buf.length; i++) {
            buf[i] = ab[i];
        }
        return buf;
    }

    });

    unwrapExports(lib);
    var lib_1 = lib.NodeHttpTransport;

    function r$1(n){if(Array.isArray(n)){for(var f=[],t=0;t<n.length;t++)f.push(r$1(n[t]));var i=Buffer.concat(f);return Buffer.concat([e$1(i.length,192),i])}var o=u$2(n);return 1===o.length&&o[0]<128?o:Buffer.concat([e$1(o.length,128),o])}function e$1(r,e){if(r<56)return Buffer.from([r+e]);var n=t$1(r),f=t$1(e+55+n.length/2);return Buffer.from(f+n,"hex")}function f$1(r){return "0x"===r.slice(0,2)}function t$1(r){if(r<0)throw new Error("Invalid integer as argument, must be unsigned!");var e=r.toString(16);return e.length%2?"0"+e:e}function u$2(r){if(!isBuffer(r)){if("string"==typeof r)return f$1(r)?Buffer.from((n="string"!=typeof(u=r)?u:f$1(u)?u.slice(2):u).length%2?"0"+n:n,"hex"):Buffer.from(r);if("number"==typeof r)return r?(e=t$1(r),Buffer.from(e,"hex")):Buffer.from([]);if(null==r)return Buffer.from([]);if(r instanceof Uint8Array)return Buffer.from(r);throw new Error("invalid type")}var e,n,u;return r}

    function n$2(t,o,r){if(void 0===t&&(t=[]),void 0===o&&(o=[]),void 0===r&&(r=[]),!t.length&&!o.length)return r;if(!t.length)return r;if(!o.length)return [].concat(r,[t[0]]);var e=t[0],i=t.slice(1),a=o[0],u=o.slice(1);return void 0!==e&&r.push(e),void 0!==a&&r.push(a),n$2(i,u,r)}function t$2(n){return function(o){return "function"==typeof o?(console.warn("\n        %cFCL/SDK Deprecation Notice\n        ============================\n\n        Interopolation of functions into template literals will not be a thing in future versions of the Flow-JS-SDK or FCL.\n        You can learn more (including a guide on common transition paths) here: https://github.com/onflow/flow-js-sdk/blob/master/packages/sdk/TRANSITIONS.md#0001-deprecate-params\n\n        ============================\n      ","font-weight:bold;font-family:monospace;"),t$2(n)(o(n))):String(o)}}function o$1(o){for(var r=arguments.length,e=new Array(r>1?r-1:0),i=1;i<r;i++)e[i-1]=arguments[i];return "string"==typeof o?function(){return o}:Array.isArray(o)?function(r){return n$2(o,e.map(t$2(r))).join("").trim()}:o}

    function O(){return (O=Object.assign||function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)Object.prototype.hasOwnProperty.call(n,r)&&(e[r]=n[r]);}return e}).apply(this,arguments)}function _(e){return (_=Object.setPrototypeOf?Object.getPrototypeOf:function(e){return e.__proto__||Object.getPrototypeOf(e)})(e)}function j(e,t){return (j=Object.setPrototypeOf||function(e,t){return e.__proto__=t,e})(e,t)}function L(){if("undefined"==typeof Reflect||!Reflect.construct)return !1;if(Reflect.construct.sham)return !1;if("function"==typeof Proxy)return !0;try{return Date.prototype.toString.call(Reflect.construct(Date,[],function(){})),!0}catch(e){return !1}}function G(e,t,n){return (G=L()?Reflect.construct:function(e,t,n){var r=[null];r.push.apply(r,t);var o=new(Function.bind.apply(e,r));return n&&j(o,n.prototype),o}).apply(null,arguments)}function C(e){var t="function"==typeof Map?new Map:void 0;return (C=function(e){if(null===e||-1===Function.toString.call(e).indexOf("[native code]"))return e;if("function"!=typeof e)throw new TypeError("Super expression must either be null or a function");if(void 0!==t){if(t.has(e))return t.get(e);t.set(e,n);}function n(){return G(e,arguments,_(this).constructor)}return n.prototype=Object.create(e.prototype,{constructor:{value:n,enumerable:!1,writable:!0,configurable:!0}}),j(n,e)})(e)}function U(e,t){(null==t||t>e.length)&&(t=e.length);for(var n=0,r=new Array(t);n<t;n++)r[n]=e[n];return r}var D,R$1='{\n  "tag":"UNKNOWN",\n  "assigns":{},\n  "status":"OK",\n  "reason":null,\n  "accounts":{},\n  "params":{},\n  "arguments":{},\n  "message": {\n    "cadence":null,\n    "refBlock":null,\n    "computeLimit":null,\n    "proposer":null,\n    "payer":null,\n    "authorizations":[],\n    "params":[],\n    "arguments":[]\n  },\n  "proposer":null,\n  "authorizations":[],\n  "payer":null,\n  "events": {\n    "eventType":null,\n    "start":null,\n    "end":null,\n    "blockIds":[]\n  },\n  "transaction": {\n    "id":null\n  },\n  "block": {\n    "id":null,\n    "height":null,\n    "isSealed":null\n  },\n  "account": {\n    "addr":null\n  },\n  "collection": {\n    "id":null\n  }\n}',K=new Set(Object.keys(JSON.parse(R$1))),F=function(){return JSON.parse(R$1)},H="abcdefghijklmnopqrstuvwxyz0123456789".split(""),z=function(){return H[~~(Math.random()*H.length)]},q=function(){return Array.from({length:10},z).join("")},J=function(e){return Array.isArray(e)},M=function(e){return null==e},W=function(e){return e.status="OK",e},Y=function(e,t){return e.status="BAD",e.reason=t,e},V=function(e){return function(t){return t.tag=e,W(t)}},$=function(t,n$1){return void 0===n$1&&(n$1={}),function(r){var o;n("function"==typeof t||"object"==typeof t,"prepAccount must be passed an authorization function or an account object"),n(null!=n$1.role,"Account must have a role");var i=JSON.parse('{\n  "kind":"ACCOUNT",\n  "tempId":null,\n  "addr":null,\n  "keyId":null,\n  "sequenceNum":null,\n  "signature":null,\n  "signingFunction":null,\n  "resolve":null,\n  "role": {\n    "proposer":false,\n    "authorizer":false,\n    "payer":false,\n    "param":false\n  }\n}'),a=n$1.role,u=q();return r.accounts[u]=O({},i,{tempId:u},t="function"==typeof t?{resolve:t}:t,{role:O({},i.role,"object"==typeof t.role?t.role:{},(o={},o[a]=!0,o))}),"authorizer"===a?r.authorizations.push(u):r[a]=u,r}},X=function(e){return function(t){var n=q();return t.message.arguments.push(n),t.arguments[n]=JSON.parse('{\n  "kind":"ARGUMENT",\n  "tempId":null,\n  "value":null,\n  "asArgument":null,\n  "xform":null,\n  "resolve": null\n}'),t.arguments[n].tempId=n,t.arguments[n].value=e.value,t.arguments[n].asArgument=e.asArgument,t.arguments[n].xform=e.xform,t.arguments[n].resolve=e.resolve,W(t)}},Q=V("SCRIPT"),Z=V("TRANSACTION"),ee=V("GET_TRANSACTION_STATUS"),te=V("GET_TRANSACTION"),ne=V("GET_ACCOUNT"),re=V("GET_EVENTS"),oe=V("GET_LATEST_BLOCK"),ie=V("GET_BLOCK_BY_ID"),ae=V("GET_BLOCK_BY_HEIGHT"),ue=V("PING"),ce=V("GET_BLOCK"),se=V("GET_BLOCK_HEADER"),le=V("GET_COLLECTION"),fe=function(e){return function(t){return t.tag===e}},me=fe("SCRIPT"),ge=fe("TRANSACTION"),pe=fe("GET_TRANSACTION_STATUS"),he=fe("GET_TRANSACTION"),ve=fe("GET_ACCOUNT"),ye=fe("GET_EVENTS"),be=fe("GET_LATEST_BLOCK"),ke=fe("GET_BLOCK_BY_ID"),Ie=fe("GET_BLOCK_BY_HEIGHT"),Se=fe("PING"),Pe=fe("GET_BLOCK"),we=fe("GET_BLOCK_HEADER"),Be=fe("GET_COLLECTION"),Ae=function(e){return "OK"===e.status},Ee=function(e){return "BAD"===e.status},Te=function(e){return e.reason},Ne=function e(t,n){void 0===n&&(n=[]);try{return Promise.resolve(function(r,o){try{var i=Promise.resolve(t).then(function(r){if(t=function(e){for(var t=0,n=Object.keys(e);t<n.length;t++){var r=n[t];if(!K.has(r))throw new Error('"'+r+'" is an invalid root level Interaction property.')}return e}(r),Ee(t))throw new Error("Interaction Error: "+t.reason);if(!n.length)return t;var o=n[0],i=n.slice(1);return Promise.resolve(o).then(function(n){if("function"==typeof n)return e(n(t),i);if(M(n)||!n)return e(t,i);if(function(e){if(null===(t=e)||"object"!=typeof t||M(e)||function(e){return "number"==typeof e}(e))return !1;for(var t,n,r=function(e,t){var n;if("undefined"==typeof Symbol||null==e[Symbol.iterator]){if(Array.isArray(e)||(n=function(e,t){if(e){if("string"==typeof e)return U(e,void 0);var n=Object.prototype.toString.call(e).slice(8,-1);return "Object"===n&&e.constructor&&(n=e.constructor.name),"Map"===n||"Set"===n?Array.from(e):"Arguments"===n||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?U(e,void 0):void 0}}(e))){n&&(e=n);var r=0;return function(){return r>=e.length?{done:!0}:{done:!1,value:e[r++]}}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}return (n=e[Symbol.iterator]()).next.bind(n)}(K);!(n=r()).done;)if(!e.hasOwnProperty(n.value))return !1;return !0}(n))return e(n,i);throw new Error("Invalid Interaction Composition")})});}catch(e){return o(e)}return i&&i.then?i.then(void 0,o):i}(0,function(e){throw e}))}catch(e){return Promise.reject(e)}},xe=function e(){var t=[].slice.call(arguments),n=t[0],r=t[1];return J(n)&&null==r?function(t){return e(t,n)}:Ne(n,r)},Oe=function(e){return e},_e=function(e,t,n){return null==e.assigns[t]?n:e.assigns[t]},je=function(e,t){return function(n){return n.assigns[e]=t,W(n)}},Le=function(e,t){return void 0===t&&(t=Oe),function(n){return n.assigns[e]=t(n.assigns[e],n),W(n)}};function Ce(e){return void 0===e&&(e=[]),xe(F(),e)}var Ue="config",De="PUT_CONFIG",Re="GET_CONFIG",Ke="CONFIG/UPDATED",Fe=function(e){return e},He=((D={})[De]=function(e,t,n){var r=n.key,o=n.value;if(null==r)throw new Error("Missing 'key' for config/put.");e.put(r,o),e.broadcast(Ke,e.all());},D[Re]=function(e,t,n){var r=n.key,o=n.fallback;if(null==r)throw new Error("Missing 'key' for config/get");t.reply(e.get(r,o));},D.UPDATE_CONFIG=function(e,t,n){var r=n.key,o=n.fn;if(null==r)throw new Error("Missing 'key' for config/update");e.update(r,o||Fe),e.broadcast(Ke,e.all());},D.DELETE_CONFIG=function(e,t,n){var r=n.key;if(null==r)throw new Error("Missing 'key' for config/delete");e.delete(r),e.broadcast(Ke,e.all());},D.WHERE_CONFIG=function(e,t,n){var r=n.pattern;if(null==r)throw new Error("Missing 'pattern' for config/where");t.reply(e.where(r));},D[f]=function(e,t){e.subscribe(t.from),e.send(t.from,Ke,e.all());},D[s]=function(e,t){e.unsubscribe(t.from);},D);function ze(e,t){return b(Ue,De,{key:e,value:t}),Ve()}function qe(e,t){return b(Ue,Re,{key:e,fallback:t},{expectReply:!0,timeout:10})}function Je(e,t){return void 0===t&&(t=Fe),b(Ue,"UPDATE_CONFIG",{key:e,fn:t}),Ve()}function Me(e){return b(Ue,"DELETE_CONFIG",{key:e}),Ve()}function We(e){return b(Ue,"WHERE_CONFIG",{pattern:e},{expectReply:!0,timeout:10})}function Ye(e){return I(Ue,function(){return m(He,Ue)},e)}function Ve(e){return null!=e&&"object"==typeof e&&Object.keys(e).map(function(t){return ze(t,e[t])}),{put:ze,get:qe,update:Je,delete:Me,where:We,subscribe:Ye}}m(He,Ue);var $e=function(){return JSON.parse('{\n    "tag":null,\n    "transaction":null,\n    "transactionStatus":null,\n    "transactionId":null,\n    "encodedData":null,\n    "events":null,\n    "account":null,\n    "block":null,\n    "blockHeader":null,\n    "latestBlock":null,\n    "collection":null\n}')},Xe=function(e,t,n){try{return Promise.resolve(Ve().get("grpc.metadata",{})).then(function(r){return new Promise(function(o,i){grpcWebClient_1.unary(t,{request:n,host:e,metadata:new grpcWebClient_1.Metadata(r),onEnd:function(e){var t=e.statusMessage;e.status===grpcWebClient_1.Code.OK?o(e.message):i(new Error(t));}});})})}catch(e){return Promise.reject(e)}};grpcWebClient_1.setDefaultTransport(lib_1());var Qe=function(e){return Buffer.from(e,"hex")},Ze=function(e){return Buffer.from(e.padStart(16,0),"hex")},et=function(e){return Buffer.from(e).toString("hex")},tt=function(e){return Buffer.from(JSON.stringify(e),"utf8")},nt=function(e){return Buffer.from(e).toString("hex")},rt=function(e){return Buffer.from(e).toString("hex")},ot=function(e){return Buffer.from(e).toString("hex")},it=function(e){return Buffer.from(e).toString("hex")},at=function(e){return Buffer.from(e).toString("hex")},ut=function(e){return Buffer.from(e).toString("hex")},ct=function(e){return Buffer.from(e).toString("hex")},st=function(e){return Buffer.from(e).toString("hex")},lt=function(e,t){void 0===t&&(t={});try{var n=function(n){return t.node=n,Promise.resolve(e).then(function(n){switch(e=n,!0){case ge(e):return t.sendTransaction?t.sendTransaction(e,t):function(e,t){void 0===t&&(t={});try{var n=t.unary||Xe;return Promise.resolve(e).then(function(r){e=r;var o=new dist_1;o.setScript(function(e){return Buffer.from(e,"utf8")}(e.message.cadence)),o.setGasLimit(e.message.computeLimit),o.setReferenceBlockId(e.message.refBlock?Qe(e.message.refBlock):null),o.setPayer(Ze(n$1(e.accounts[e.payer].addr))),e.message.arguments.forEach(function(t){return o.addArguments(function(e){return Buffer.from(JSON.stringify(e),"utf8")}(e.arguments[t].asArgument))}),e.authorizations.map(function(t){return e.accounts[t].addr}).reduce(function(e,t){return e.find(function(e){return e===t})?e:[].concat(e,[t])},[]).forEach(function(e){return o.addAuthorizers(Ze(n$1(e)))});var i=new dist_1.ProposalKey;i.setAddress(Ze(n$1(e.accounts[e.proposer].addr))),i.setKeyId(e.accounts[e.proposer].keyId),i.setSequenceNumber(e.accounts[e.proposer].sequenceNum),o.setProposalKey(i);for(var s=0,l=Object.values(e.accounts);s<l.length;s++){var f=l[s];try{if(!f.role.payer&&null!=f.signature){var d=new dist_1.Signature;d.setAddress(Ze(n$1(f.addr))),d.setKeyId(f.keyId),d.setSignature(Qe(f.signature)),o.addPayloadSignatures(d);}}catch(t){throw console.error("Trouble applying payload signature",{acct:f,ix:e}),t}}for(var m=0,g=Object.values(e.accounts);m<g.length;m++){var p=g[m];try{if(p.role.payer&&null!=p.signature){var h=new dist_1.Signature;h.setAddress(Ze(n$1(p.addr))),h.setKeyId(p.keyId),h.setSignature(Qe(p.signature)),o.addEnvelopeSignatures(h);}}catch(t){throw console.error("Trouble applying envelope signature",{acct:p,ix:e}),t}}var v=new dist_2;v.setTransaction(o);var y=Date.now();return Promise.resolve(n(t.node,dist_3.SendTransaction,v)).then(function(t){var n,r=Date.now(),o=$e();return o.tag=e.tag,o.transactionId=(n=t.getId_asU8(),Buffer.from(n).toString("hex")),"undefined"!=typeof window&&window.dispatchEvent(new CustomEvent("FLOW::TX",{detail:{txId:o.transactionId,delta:r-y}})),o})})}catch(e){return Promise.reject(e)}}(e,t);case pe(e):return t.sendGetTransactionStatus?t.sendGetTransactionStatus(e,t):function(e,t){void 0===t&&(t={});try{var n=t.unary||Xe;return Promise.resolve(e).then(function(r){e=r;var o=new dist_4;return o.setId(Buffer.from(e.transaction.id,"hex")),Promise.resolve(n(t.node,dist_3.GetTransactionResult,o)).then(function(t){var n=t.getEventsList(),r=$e();return r.tag=e.tag,r.transactionStatus={status:t.getStatus(),statusCode:t.getStatusCode(),errorMessage:t.getErrorMessage(),events:n.map(function(e){return {type:e.getType(),transactionId:(t=e.getTransactionId_asU8(),Buffer.from(t).toString("hex")),transactionIndex:e.getTransactionIndex(),eventIndex:e.getEventIndex(),payload:JSON.parse(Buffer.from(e.getPayload_asU8()).toString("utf8"))};var t;})},r})})}catch(e){return Promise.reject(e)}}(e,t);case he(e):return t.sendGetTransaction?t.sendGetTransaction(e,t):function(e,t){void 0===t&&(t={});try{var n=t.unary||Xe;return Promise.resolve(e).then(function(r){e=r;var o=new dist_4;return o.setId(Buffer.from(e.transaction.id,"hex")),Promise.resolve(n(t.node,dist_3.GetTransaction,o)).then(function(t){var n=$e();n.tag=e.tag;var r,o=function(e){return {address:et(e.getAddress_asU8()),keyId:e.getKeyId(),signature:et(e.getSignature_asU8())}},i=t.getTransaction();return n.transaction={script:Buffer.from(i.getScript_asU8()).toString("utf8"),args:i.getArgumentsList().map(function(e){return JSON.parse(Buffer.from(e).toString("utf8"))}),referenceBlockId:et(i.getReferenceBlockId_asU8()),gasLimit:i.getGasLimit(),proposalKey:(r=i.getProposalKey(),{address:et(r.getAddress_asU8()),keyId:r.getKeyId(),sequenceNumber:r.getSequenceNumber()}),payer:et(i.getPayer_asU8()),authorizers:i.getAuthorizersList().map(et),payloadSignatures:i.getPayloadSignaturesList().map(o),envelopeSignatures:i.getEnvelopeSignaturesList().map(o)},n})})}catch(e){return Promise.reject(e)}}(e,t);case me(e):return t.sendExecuteScript?t.sendExecuteScript(e,t):function(e,t){void 0===t&&(t={});try{var n=t.unary||Xe;return Promise.resolve(e).then(function(r){function o(){var t=$e();return t.tag=e.tag,t.encodedData=JSON.parse(Buffer.from(a.getValue_asU8()).toString("utf8")),t}var i,a;e=r;var u=function(){if(e.block.id){(i=new dist_5).setBlockId(Buffer.from(e.block.id,"hex"));var r=Buffer.from(e.message.cadence,"utf8");return e.message.arguments.forEach(function(t){return i.addArguments(tt(e.arguments[t].asArgument))}),i.setScript(r),Promise.resolve(n(t.node,dist_3.ExecuteScriptAtBlockID,i)).then(function(e){a=e;})}var o=function(){if(e.block.height){(i=new dist_6).setBlockHeight(Number(e.block.height));var r=Buffer.from(e.message.cadence,"utf8");return e.message.arguments.forEach(function(t){return i.addArguments(tt(e.arguments[t].asArgument))}),i.setScript(r),Promise.resolve(n(t.node,dist_3.ExecuteScriptAtBlockHeight,i)).then(function(e){a=e;})}i=new dist_7;var o=Buffer.from(e.message.cadence,"utf8");return e.message.arguments.forEach(function(t){return i.addArguments(tt(e.arguments[t].asArgument))}),i.setScript(o),Promise.resolve(n(t.node,dist_3.ExecuteScriptAtLatestBlock,i)).then(function(e){a=e;})}();if(o&&o.then)return o.then(function(){})}();return u&&u.then?u.then(o):o()})}catch(e){return Promise.reject(e)}}(e,t);case ve(e):return t.sendGetAccount?t.sendGetAccount(e,t):function(e,t){void 0===t&&(t={});try{var n=t.unary||Xe;return Promise.resolve(e).then(function(r){var o,i=(e=r).block.height?new dist_8:new dist_9;return e.block.height&&i.setBlockHeight(Number(e.block.height)),i.setAddress((o=n$1(e.account.addr),Buffer.from(o.padStart(16,0),"hex"))),Promise.resolve(n(t.node,e.block.height?dist_3.GetAccountAtBlockHeight:dist_3.GetAccountAtLatestBlock,i)).then(function(t){var n=$e();n.tag=e.tag;var r,o=t.getAccount(),i=(r=o.getContractsMap())?r.getEntryList().reduce(function(e,t){var n;return O({},e,((n={})[t[0]]=Buffer.from(t[1]||new UInt8Array).toString("utf8"),n))},{}):{};return n.account={address:l$1(nt(o.getAddress_asU8())),balance:o.getBalance(),code:Buffer.from(o.getCode_asU8()||new UInt8Array).toString("utf8"),contracts:i,keys:o.getKeysList().map(function(e){return {index:e.getIndex(),publicKey:nt(e.getPublicKey_asU8()),signAlgo:e.getSignAlgo(),hashAlgo:e.getHashAlgo(),weight:e.getWeight(),sequenceNumber:e.getSequenceNumber(),revoked:e.getRevoked()}})},n})})}catch(e){return Promise.reject(e)}}(e,t);case ye(e):return t.sendGetEvents?t.sendGetEvents(e,t):function(e,t){void 0===t&&(t={});try{var n=t.unary||Xe;return Promise.resolve(e).then(function(r){function o(){var t=$e();t.tag=e.tag;var n=i.getResultsList();return t.events=n.reduce(function(e,t){var n=rt(t.getBlockId_asU8()),r=t.getBlockHeight(),o=t.getBlockTimestamp().toDate().toISOString();return t.getEventsList().forEach(function(t){e.push({blockId:n,blockHeight:r,blockTimestamp:o,type:t.getType(),transactionId:rt(t.getTransactionId_asU8()),transactionIndex:t.getTransactionIndex(),eventIndex:t.getEventIndex(),payload:JSON.parse(Buffer.from(t.getPayload_asU8()).toString("utf8"))});}),e},[]),t}var i,a=(e=r).events.start?new dist_10:new dist_11;a.setType(e.events.eventType);var u=e.events.start?(a.setStartHeight(Number(e.events.start)),a.setEndHeight(Number(e.events.end)),Promise.resolve(n(t.node,dist_3.GetEventsForHeightRange,a)).then(function(e){i=e;})):(e.events.blockIds.forEach(function(e){return a.addBlockIds(Buffer.from(e,"hex"))}),Promise.resolve(n(t.node,dist_3.GetEventsForBlockIDs,a)).then(function(e){i=e;}));return u&&u.then?u.then(o):o()})}catch(e){return Promise.reject(e)}}(e,t);case be(e):return t.sendGetLatestBlock?t.sendGetLatestBlock(e,t):function(e,t){void 0===t&&(t={});try{return Promise.resolve(e).then(function(n){e=n;var r=new dist_12;return e.latestBlock&&e.latestBlock.isSealed&&(r.setIsSealed(e.latestBlock.isSealed),console.error("\n          %c@onflow/send Deprecation Notice\n          ========================\n\n          Operating upon data of the latestBlock field of the interaction object is deprecated and will no longer be recognized in future releases of @onflow/send.\n          Find out more here: https://github.com/onflow/flow-js-sdk/blob/master/packages/send/WARNINGS.md#0001-Deprecating-latestBlock-field\n\n          =======================\n        ".replace(/\n\s+/g,"\n").trim(),"font-weight:bold;font-family:monospace;")),e.block&&e.block.isSealed&&r.setIsSealed(e.block.isSealed),Promise.resolve(Xe(t.node,dist_3.GetLatestBlock,r)).then(function(t){var n=t.getBlock(),r=n.getCollectionGuaranteesList(),o=n.getBlockSealsList(),i=n.getSignaturesList(),a=$e();return a.tag=e.tag,a.block={id:at(n.getId_asU8()),parentId:at(n.getParentId_asU8()),height:n.getHeight(),timestamp:n.getTimestamp(),collectionGuarantees:r.map(function(e){return {collectionId:at(e.getCollectionId_asU8()),signatures:e.getSignaturesList()}}),blockSeals:o.map(function(e){return {blockId:at(e.getBlockId_asU8()),executionReceiptId:at(e.getExecutionReceiptId_asU8()),executionReceiptSignatures:e.getExecutionReceiptSignaturesList(),resultApprovalSignatures:e.getResultApprovalSignaturesList()}}),signatures:i},a})})}catch(e){return Promise.reject(e)}}(e,t);case Pe(e):return t.sendGetBlock?t.sendGetBlock(e,t):function(e,t){void 0===t&&(t={});try{var n=t.unary||Xe;return Promise.resolve(e).then(function(r){function o(){var t=a.getBlock(),n=t.getCollectionGuaranteesList(),r=t.getBlockSealsList(),o=t.getSignaturesList().map(ot),i=$e();return i.tag=e.tag,i.block={id:ot(t.getId_asU8()),parentId:ot(t.getParentId_asU8()),height:t.getHeight(),timestamp:t.getTimestamp().toDate().toISOString(),collectionGuarantees:n.map(function(e){return {collectionId:ot(e.getCollectionId_asU8()),signatures:e.getSignaturesList().map(ot)}}),blockSeals:r.map(function(e){return {blockId:ot(e.getBlockId_asU8()),executionReceiptId:ot(e.getExecutionReceiptId_asU8()),executionReceiptSignatures:e.getExecutionReceiptSignaturesList().map(ot),resultApprovalSignatures:e.getResultApprovalSignaturesList().map(ot)}}),signatures:o},i}var i,a;e=r;var u=function(){if(e.block.id)return (i=new dist_13).setId(Buffer.from(e.block.id,"hex")),Promise.resolve(n(t.node,dist_3.GetBlockByID,i)).then(function(e){a=e;});var r=e.block.height?((i=new dist_14).setHeight(Number(e.block.height)),Promise.resolve(n(t.node,dist_3.GetBlockByHeight,i)).then(function(e){a=e;})):(i=new dist_12,e.block&&e.block.isSealed&&i.setIsSealed(e.block.isSealed),Promise.resolve(n(t.node,dist_3.GetLatestBlock,i)).then(function(e){a=e;}));return r&&r.then?r.then(function(){}):void 0}();return u&&u.then?u.then(o):o()})}catch(e){return Promise.reject(e)}}(e,t);case we(e):return t.sendGetBlockHeader?t.sendGetBlockHeader(e,t):function(e,t){void 0===t&&(t={});try{var n=t.unary||Xe;return Promise.resolve(e).then(function(r){function o(){var t=a.getBlock(),n=$e();return n.tag=e.tag,n.blockHeader={id:it(t.getId_asU8()),parentId:it(t.getParentId_asU8()),height:t.getHeight(),timestamp:t.getTimestamp().toDate().toISOString()},n}var i,a;e=r;var u=function(){if(e.block.id)return (i=new dist_15).setId(Buffer.from(e.block.id,"hex")),Promise.resolve(n(t.node,dist_3.GetBlockHeaderByID,i)).then(function(e){a=e;});var r=e.block.height?((i=new dist_16).setHeight(Number(e.block.height)),Promise.resolve(n(t.node,dist_3.GetBlockHeaderByHeight,i)).then(function(e){a=e;})):(i=new dist_17,e.block&&e.block.isSealed&&i.setIsSealed(e.block.isSealed),Promise.resolve(n(t.node,dist_3.GetLatestBlockHeader,i)).then(function(e){a=e;}));return r&&r.then?r.then(function(){}):void 0}();return u&&u.then?u.then(o):o()})}catch(e){return Promise.reject(e)}}(e,t);case ke(e):return t.sendGetBlockById?t.sendGetBlockById(e,t):function(e,t){void 0===t&&(t={});try{return Promise.resolve(e).then(function(n){e=n;var r=new dist_13;return r.setId(Buffer.from(e.block.id,"hex")),Promise.resolve(Xe(t.node,dist_3.GetBlockByID,r)).then(function(t){var n=t.getBlock(),r=n.getCollectionGuaranteesList(),o=n.getBlockSealsList(),i=n.getSignaturesList(),a=$e();return a.tag=e.tag,a.block={id:ut(n.getId_asU8()),parentId:ut(n.getParentId_asU8()),height:n.getHeight(),timestamp:n.getTimestamp(),collectionGuarantees:r.map(function(e){return {collectionId:ut(e.getCollectionId_asU8()),signatures:e.getSignaturesList()}}),blockSeals:o.map(function(e){return {blockId:ut(e.getBlockId_asU8()),executionReceiptId:ut(e.getExecutionReceiptId_asU8()),executionReceiptSignatures:e.getExecutionReceiptSignaturesList(),resultApprovalSignatures:e.getResultApprovalSignaturesList()}}),signatures:i},a})})}catch(e){return Promise.reject(e)}}(e,t);case Ie(e):return t.sendGetBlockByHeight?t.sendGetBlockByHeight(e,t):function(e,t){void 0===t&&(t={});try{return Promise.resolve(e).then(function(n){e=n;var r=new dist_14;return r.setHeight(Number(e.block.height)),Promise.resolve(Xe(t.node,dist_3.GetBlockByHeight,r)).then(function(t){var n=t.getBlock(),r=n.getCollectionGuaranteesList(),o=n.getBlockSealsList(),i=n.getSignaturesList(),a=$e();return a.tag=e.tag,a.block={id:ct(n.getId_asU8()),parentId:ct(n.getParentId_asU8()),height:n.getHeight(),timestamp:n.getTimestamp(),collectionGuarantees:r.map(function(e){return {collectionId:ct(e.getCollectionId_asU8()),signatures:e.getSignaturesList()}}),blockSeals:o.map(function(e){return {blockId:ct(e.getBlockId_asU8()),executionReceiptId:ct(e.getExecutionReceiptId_asU8()),executionReceiptSignatures:e.getExecutionReceiptSignaturesList(),resultApprovalSignatures:e.getResultApprovalSignaturesList()}}),signatures:i},a})})}catch(e){return Promise.reject(e)}}(e,t);case Be(e):return t.sendGetCollection?t.sendGetCollection(e,t):function(e,t){void 0===t&&(t={});try{var n=t.unary||Xe;return Promise.resolve(e).then(function(r){e=r;var o=new dist_18;return o.setId(Buffer.from(e.collection.id,"hex")),Promise.resolve(n(t.node,dist_3.GetCollectionByID,o)).then(function(t){var n=t.getCollection(),r=$e();return r.tag=e.tag,r.collection={id:st(n.getId_asU8()),transactionIds:n.getTransactionIdsList().map(st)},r})})}catch(e){return Promise.reject(e)}}(e,t);case Se(e):return t.sendPing?t.sendPing(e,t):function(e,t){void 0===t&&(t={});try{var n=t.unary||Xe;return Promise.resolve(e).then(function(r){e=r;var o=new dist_19;return Promise.resolve(n(t.node,dist_3.Ping,o)).then(function(t){var n=$e();return n.tag=e.tag,n})})}catch(e){return Promise.reject(e)}}(e,t);default:return e}})},r=t.node;return Promise.resolve(r?n(r):Promise.resolve(Ve().get("accessNode.api")).then(n))}catch(e){return Promise.reject(e)}};function ft(e){return void 0===e&&(e=null),xe([ce,function(t){return t.block.isSealed=e,W(t)}])}function dt(e){return xe([ne,function(t){return t.account.addr=n$1(e),W(t)}])}var mt=function(e,t,n){try{try{return Promise.resolve(Number(e))}catch(e){throw new Error("Decode Number Error : "+n.join("."))}}catch(e){return Promise.reject(e)}},gt=function(e){return Promise.resolve(e)},pt=function(e,t,n){try{return Promise.resolve(e.fields.reduce(function(e,r){try{return Promise.resolve(e).then(function(o){return e=o,Promise.resolve(yt(r.value,t,[].concat(n,[r.name]))).then(function(t){return e[r.name]=t,e})})}catch(e){return Promise.reject(e)}},Promise.resolve({}))).then(function(n){var r=e.id&&vt(t,e.id);return r?Promise.resolve(r(n)):n})}catch(e){return Promise.reject(e)}},ht={UInt:mt,Int:mt,UInt8:mt,Int8:mt,UInt16:mt,Int16:mt,UInt32:mt,Int32:mt,UInt64:mt,Int64:mt,UInt128:mt,Int128:mt,UInt256:mt,Int256:mt,Word8:mt,Word16:mt,Word32:mt,Word64:mt,UFix64:gt,Fix64:gt,String:gt,Character:gt,Bool:gt,Address:gt,Void:function(){return Promise.resolve(null)},Optional:function(e,t,n){return Promise.resolve(e?yt(e,t,n):null)},Reference:function(e){try{return Promise.resolve({address:e.address,type:e.type})}catch(e){return Promise.reject(e)}},Array:function(e,t,n){try{return Promise.resolve(Promise.all(e.map(function(e){return new Promise(function(r){try{return Promise.resolve(yt(e,t,[].concat(n,[e.type]))).then(r)}catch(e){return Promise.reject(e)}})})))}catch(e){return Promise.reject(e)}},Dictionary:function(e,t,n){try{return Promise.resolve(e.reduce(function(e,r){try{return Promise.resolve(e).then(function(o){return e=o,Promise.resolve(yt(r.key,t,[].concat(n,[r.key]))).then(function(o){return Promise.resolve(yt(r.value,t,[].concat(n,[r.key]))).then(function(t){return e[o]=t,e})})})}catch(e){return Promise.reject(e)}},Promise.resolve({})))}catch(e){return Promise.reject(e)}},Event:pt,Resource:pt,Struct:pt},vt=function(e,t){var n=Object.keys(e).find(function(e){return /^\/.*\/$/.test(e)?new RegExp(e.substring(1,e.length-1)).test(t):e===t});return t&&n&&e[n]},yt=function(e,t,n){try{var r=vt(t,e.type);if(!r)throw new Error("Undefined Decoder Error: "+e.type+"@"+n.join("."));return Promise.resolve(r(e.value,t,n))}catch(e){return Promise.reject(e)}},bt=function(e,t,n){void 0===t&&(t={}),void 0===n&&(n=[]);var r=O({},ht,t);return Promise.resolve(yt(e,r,n))},kt=function(e,t){void 0===t&&(t={});try{var n,r=O({},ht,t),o=e.encodedData?(n=1,Promise.resolve(bt(e.encodedData,r))):e.transactionStatus?(n=1,Promise.resolve(Promise.all(e.transactionStatus.events.map(function(e){try{var t=e.eventIndex,n=e.transactionIndex,o=e.transactionId,i=e.type;return Promise.resolve(bt(e.payload,r)).then(function(e){return {type:i,transactionId:o,transactionIndex:n,eventIndex:t,data:e}})}catch(e){return Promise.reject(e)}}))).then(function(t){return O({},e.transactionStatus,{events:t})})):e.transaction?(n=1,e.transaction):e.events?(n=1,Promise.resolve(Promise.all(e.events.map(function(e){try{var t=e.eventIndex,n=e.transactionIndex,o=e.transactionId,i=e.type,a=e.blockTimestamp,u=e.blockHeight,c=e.blockId;return Promise.resolve(bt(e.payload,r)).then(function(e){return {blockId:c,blockHeight:u,blockTimestamp:a,type:i,transactionId:o,transactionIndex:n,eventIndex:t,data:e}})}catch(e){return Promise.reject(e)}})))):e.account?(n=1,e.account):e.block?(n=1,e.block):e.blockHeader?(n=1,e.blockHeader):e.latestBlock?(console.error("\n          %c@onflow/decode Deprecation Notice\n          ========================\n\n          Operating upon data of the latestBlock field of the response object is deprecated and will no longer be recognized in future releases of @onflow/decode.\n          Find out more here: https://github.com/onflow/flow-js-sdk/blob/master/packages/decode/WARNINGS.md#0001-Deprecating-latestBlock-field\n\n          =======================\n        ".replace(/\n\s+/g,"\n").trim(),"font-weight:bold;font-family:monospace;"),n=1,e.latestBlock):e.transactionId?(n=1,e.transactionId):e.collection?(n=1,e.collection):void 0;return Promise.resolve(o&&o.then?o.then(function(e){return n?e:null}):n?o:null)}catch(e){return Promise.reject(e)}};var St=function(t){try{var n$1=function(){if(ge(t)||me(t)){var n$1=function(){return n(wt(r),"Cadence needs to be a string at this point."),Promise.resolve(Ve().where(/^0x/).then(function(e){return Object.entries(e).reduce(function(e,t){return e.replace(t[0],t[1])},r)})).then(function(e){t.message.cadence=e;})},r=_e(t,"ix.cadence");n(Pt(r)||wt(r),"Cadence needs to be a function or a string.");var o=function(){if(Pt(r))return Promise.resolve(r({})).then(function(e){r=e;})}();return o&&o.then?o.then(n$1):n$1()}}();return Promise.resolve(n$1&&n$1.then?n$1.then(function(){return t}):t)}catch(e){return Promise.reject(e)}},Pt=function(e){return "function"==typeof e},wt=function(e){return "string"==typeof e},Bt=function(e){try{if(ge(e)||me(e))for(var t=0,n=Object.entries(e.arguments);t<n.length;t++){var r=n[t];e.arguments[r[0]].asArgument=Et(r[1]);}return Promise.resolve(e)}catch(e){return Promise.reject(e)}},At=function(e){return "function"==typeof e};function Et(t){return n(null!=typeof t.xform,"No type specified for argument: "+t.value),At(t.xform)?t.xform(t.value):At(t.xform.asArgument)?t.xform.asArgument(t.value):void n(!1,"Invalid Argument",t)}var Tt,Nt=function(e){return jt(Ut(Dt(e)))},xt=function(e){return jt(Ut(Rt(e)))},Ot=function(e,t){return Buffer.from(e.padStart(2*t,0),"hex")},_t=(Tt=Buffer.from("FLOW-V0.0-transaction").toString("hex"),Buffer.from(Tt.padEnd(64,0),"hex")).toString("hex"),jt=function(e){return _t+e},Lt=function(e){return Ot(e,8)},Gt=function(e){return Buffer.from(JSON.stringify(e),"utf8")},Ct=function(e){return Buffer.from(e,"utf8")},Ut=function(e){return r$1(e).toString("hex")},Dt=function(e){return Ht(e),[Ct(e.cadence),e.arguments.map(Gt),(t=e.refBlock,Ot(t,32)),e.computeLimit,Lt(e.proposalKey.address),e.proposalKey.keyId,e.proposalKey.sequenceNum,Lt(e.payer),e.authorizers.map(Lt)];var t;},Rt=function(e){return zt(e),[Dt(e),Kt(e)]},Kt=function(e){var t=Ft(e);return e.payloadSigs.map(function(e){return {signerIndex:t.get(e.address),keyId:e.keyId,sig:e.sig}}).sort(function(e,t){return e.signerIndex>t.signerIndex?1:e.signerIndex<t.signerIndex?-1:e.keyId>t.keyId?1:e.keyId<t.keyId?-1:void 0}).map(function(e){return [e.signerIndex,e.keyId,(t=e.sig,Buffer.from(t,"hex"))];var t;})},Ft=function(e){var t=new Map,n=0,r=function(e){t.has(e)||(t.set(e,n),n++);};return r(e.proposalKey.address),r(e.payer),e.authorizers.forEach(r),t},Ht=function(e){Yt.forEach(function(t){return Qt(e,t)}),Vt.forEach(function(t){return Qt(e.proposalKey,t,"proposalKey")});},zt=function(e){$t.forEach(function(t){return Qt(e,t)}),e.payloadSigs.forEach(function(e,t){Xt.forEach(function(n){return Qt(e,n,"payloadSigs",t)});});},qt=function(e){return "number"==typeof e},Jt=function(e){return "string"==typeof e},Mt=function(e){return null!==e&&"object"==typeof e},Wt=function(e){return Mt(e)&&e instanceof Array},Yt=[{name:"cadence",check:Jt},{name:"arguments",check:Wt},{name:"refBlock",check:Jt,defaultVal:"0"},{name:"computeLimit",check:qt},{name:"proposalKey",check:Mt},{name:"payer",check:Jt},{name:"authorizers",check:Wt}],Vt=[{name:"address",check:Jt},{name:"keyId",check:qt},{name:"sequenceNum",check:qt}],$t=[{name:"payloadSigs",check:Wt}],Xt=[{name:"address",check:Jt},{name:"keyId",check:qt},{name:"sig",check:Jt}],Qt=function(e,t,n,r){var o=t.name,i=t.check,a=t.defaultVal;if(null==e[o]&&null!=a&&(e[o]=a),null==e[o])throw en(o,n,r);if(!i(e[o]))throw tn(o,n,r)},Zt=function(e,t,n){return t?null==n?t+"."+e:t+"."+n+"."+e:e},en=function(e,t,n){return new Error("Missing field "+Zt(e,t,n))},tn=function(e,t,n){return new Error("Invalid field "+Zt(e,t,n))},nn=function(e){try{var t=function(){if(ge(e))return function(t,n){try{var r=(o=rn(e),i=Nt(un(e)),Promise.resolve(Promise.all(o.map(on(e,i)))).then(function(){var t=function(e){var t=new Set([e.payer]);return Array.from(t)}(e),n=xt(O({},un(e),{payloadSigs:o.map(function(t){return {address:e.accounts[t].addr,keyId:e.accounts[t].keyId,sig:e.accounts[t].signature}})}));return Promise.resolve(Promise.all(t.map(on(e,n)))).then(function(){})}));}catch(e){return n(e)}var o,i;return r&&r.then?r.then(void 0,n):r}(0,function(t){throw console.error("Signatures",t,{ix:e}),t})}();return Promise.resolve(t&&t.then?t.then(function(t){return e}):e)}catch(e){return Promise.reject(e)}};function rn(e){var t=new Set(e.authorizations);return t.add(e.proposer),t.delete(e.payer),Array.from(t)}function on(e,t){return function(n){try{var r=e.accounts[n];return null!=r.signature?Promise.resolve():Promise.resolve(r.signingFunction(function(e,t,n){try{return {f_type:"Signable",f_vsn:"1.0.1",message:t,addr:n$1(e.addr),keyId:e.keyId,roles:e.role,cadence:n.message.cadence,args:n.message.arguments.map(function(e){return n.arguments[e].asArgument}),data:{},interaction:n,voucher:an(n)}}catch(e){throw console.error("buildSignable",e),e}}(r,t,e))).then(function(t){e.accounts[n].signature=t.signature;})}catch(e){return Promise.reject(e)}}}var an=function(e){return {cadence:e.message.cadence,refBlock:e.message.refBlock||null,computeLimit:e.message.computeLimit,arguments:e.message.arguments.map(function(t){return e.arguments[t].asArgument}),proposalKey:{address:l$1(e.accounts[e.proposer].addr),keyId:e.accounts[e.proposer].keyId,sequenceNum:e.accounts[e.proposer].sequenceNum},payer:l$1(e.accounts[e.payer].addr),authorizers:e.authorizations.map(function(t){return l$1(e.accounts[t].addr)}).reduce(function(e,t){return e.find(function(e){return e===t})?e:[].concat(e,[t])},[]),payloadSigs:rn(e).map(function(t){return {address:l$1(e.accounts[t].addr),keyId:e.accounts[t].keyId,sig:e.accounts[t].signature}})}};function un(e){return {cadence:e.message.cadence,refBlock:e.message.refBlock||null,computeLimit:e.message.computeLimit,arguments:e.message.arguments.map(function(t){return e.arguments[t].asArgument}),proposalKey:{address:n$1(e.accounts[e.proposer].addr),keyId:e.accounts[e.proposer].keyId,sequenceNum:e.accounts[e.proposer].sequenceNum},payer:n$1(e.accounts[e.payer].addr),authorizers:e.authorizations.map(function(t){return n$1(e.accounts[t].addr)}).reduce(function(e,t){return e.find(function(e){return e===t})?e:[].concat(e,[t])},[])}}var cn="undefined"!=typeof Symbol?Symbol.iterator||(Symbol.iterator=Symbol("Symbol.iterator")):"@@iterator";function sn(e,t,n){if(!e.s){if(n instanceof ln){if(!n.s)return void(n.o=sn.bind(null,e,t));1&t&&(t=n.s),n=n.v;}if(n&&n.then)return void n.then(sn.bind(null,e,t),sn.bind(null,e,2));e.s=t,e.v=n;var r=e.o;r&&r(e);}}var ln=function(){function e(){}return e.prototype.then=function(t,n){var r=new e,o=this.s;if(o){var i=1&o?t:n;if(i){try{sn(r,1,i(this.v));}catch(e){sn(r,2,e);}return r}return this}return this.o=function(e){try{var o=e.v;1&e.s?sn(r,1,t?t(o):o):n?sn(r,1,n(o)):sn(r,2,o);}catch(e){sn(r,2,e);}},r},e}();function fn(e){return e instanceof ln&&1&e.s}var dn=function(e){try{var t=function(){if(ge(e))return function(t,n){try{var r=Promise.resolve(mn(e,Object.values(e.accounts))).then(function(){return Promise.resolve(mn(e,Object.values(e.accounts))).then(function(){})});}catch(e){return n(e)}return r&&r.then?r.then(void 0,n):r}(0,function(e){throw console.error("=== SAD PANDA ===\n\n",e,"\n\n=== SAD PANDA ==="),e})}();return Promise.resolve(t&&t.then?t.then(function(t){return e}):e)}catch(e){return Promise.reject(e)}},mn=function t(n$1,r,o,i){void 0===i&&(i=3);try{var a=function(){o&&(n$1.authorizations=n$1.authorizations.map(function(e){return e===o.tempId?u:e}).reduce(function(e,t){return Array.isArray(t)?[].concat(e,t):[].concat(e,[t])},[]));};n(i,"Account Resolve Recursion Limit Exceeded",{ix:n$1,accounts:r});var u=[],c=function(e,t,n){if("function"==typeof e[cn]){var r,o,i,a=e[cn]();if(function e(n){try{for(;!(r=a.next()).done;)if((n=t(r.value))&&n.then){if(!fn(n))return void n.then(e,i||(i=sn.bind(null,o=new ln,2)));n=n.v;}o?sn(o,1,n):o=n;}catch(e){sn(o||(o=new ln),2,e);}}(),a.return){var u=function(e){try{r.done||a.return();}catch(e){}return e};if(o&&o.then)return o.then(u,function(e){throw u(e)});u();}return o}if(!("length"in e))throw new TypeError("Object is not iterable");for(var c=[],s=0;s<e.length;s++)c.push(e[s]);return function(e,t,n){var r,o,i=-1;return function n(a){try{for(;++i<e.length;)if((a=t(i))&&a.then){if(!fn(a))return void a.then(n,o||(o=sn.bind(null,r=new ln,2)));a=a.v;}r?sn(r,1,a):r=a;}catch(e){sn(r||(r=new ln),2,e);}}(),r}(c,function(e){return t(c[e])})}(r,function(e){function r(){function r(){a.tempId!=e.tempId&&delete n$1.accounts[a.tempId];}var c=function(){if(Array.isArray(e))return Promise.resolve(t(n$1,e,a,i-1)).then(function(){});n$1.accounts[e.tempId]=n$1.accounts[e.tempId]||e,n$1.accounts[e.tempId].role.proposer=n$1.accounts[e.tempId].role.proposer||e.role.proposer,n$1.accounts[e.tempId].role.payer=n$1.accounts[e.tempId].role.payer||e.role.payer,n$1.accounts[e.tempId].role.authorizer=n$1.accounts[e.tempId].role.authorizer||e.role.authorizer,n$1.accounts[e.tempId].role.proposer&&n$1.proposer===a.tempId&&(n$1.proposer=e.tempId),n$1.accounts[e.tempId].role.payer&&n$1.payer===a.tempId&&(n$1.payer=e.tempId),n$1.accounts[e.tempId].role.authorizer&&(o?u=[].concat(u,[e.tempId]):n$1.authorizations=n$1.authorizations.map(function(t){return t===a.tempId?e.tempId:t}));}();return c&&c.then?c.then(r):r()}var a=o||e,c=function(){if(gn(e.resolve))return Promise.resolve(e.resolve(e,function(e,t){try{return {f_type:"PreSignable",f_vsn:"1.0.1",roles:e.role,cadence:t.message.cadence,args:t.message.arguments.map(function(e){return t.arguments[e].asArgument}),data:{},interaction:t,voucher:an(t)}}catch(e){throw console.error("buildPreSignable",e),e}}(e,n$1))).then(function(t){e=t;})}();return c&&c.then?c.then(r):r()});return Promise.resolve(c&&c.then?c.then(a):a())}catch(e){return Promise.reject(e)}},gn=function(e){return "function"==typeof e},pn=function(e){try{var t=_e(e,"ix.validators",[]);return Promise.resolve(xe(e,t.map(function(e){return function(t){return e(t,{Ok:W,Bad:Y})}})))}catch(e){return Promise.reject(e)}},hn=function(e){try{for(var t=0,n=Object.keys(e.accounts);t<n.length;t++){var r=n[t];e.accounts[r].addr=n$1(e.accounts[r].addr);}return Promise.resolve(e)}catch(e){return Promise.reject(e)}},vn=xe([St,Bt,dn,function(e){try{var t=function(){if(ge(e)&&null==e.message.refBlock)return Promise.resolve(lt(Ce([ft()])).then(kt)).then(function(t){e.message.refBlock=t.id;})}();return Promise.resolve(t&&t.then?t.then(function(){return e}):e)}catch(e){return Promise.reject(e)}},function(t){try{var n$1=function(){if(ge(t)){var n$1=Object.values(t.accounts).find(function(e){return e.role.proposer});n(n$1,"Transactions require a proposer");var r=function(){if(null==n$1.sequenceNum)return Promise.resolve(Ce([dt(n$1.addr)])).then(function(e){return Promise.resolve(lt(e).then(kt).then(function(e){return e.keys}).then(function(e){return e.find(function(e){return e.index===n$1.keyId})}).then(function(e){return e.sequenceNumber})).then(function(e){t.accounts[n$1.tempId].sequenceNum=e;})})}();if(r&&r.then)return r.then(function(){})}}();return Promise.resolve(n$1&&n$1.then?n$1.then(function(){return t}):t)}catch(e){return Promise.reject(e)}},nn,hn,pn]),yn=function(e,t){void 0===e&&(e=[]),void 0===t&&(t={});try{return Promise.resolve(Ve().get("sdk.send",t.send||lt)).then(function(n){return Promise.resolve(Ve().get("sdk.resolve",t.resolve||vn)).then(function(r){return Array.isArray(e)&&(e=xe(F(),e)),Promise.resolve(r(e)).then(function(e){return n(e,t)})})})}catch(e){return Promise.reject(e)}},bn=function(e){try{return Promise.resolve(Ve().where(/^decoder\./)).then(function(t){var n=Object.entries(t).map(function(e){var t=e[0],n=e[1];return [t="/"+t.replace(/^decoder\./,"")+"$/",n]});return kt(e,Object.fromEntries(n))})}catch(e){return Promise.reject(e)}},kn=function(e){var t,n;function r(t){var n,r=("\n        Encode Message From Signable Error: Unable to determine message encoding for signer addresss: "+t+". \n        Please ensure the address: "+t+" is intended to sign the given transaction as specified by the transaction signable.\n      ").trim();return (n=e.call(this,r)||this).name="Unable To Determine Message Encoding For Signer Addresss",n}return n=e,(t=r).prototype=Object.create(n.prototype),t.prototype.constructor=t,t.__proto__=n,r}(C(Error));function Sn(){var e=[].slice.call(arguments),t=e[1]||("object"==typeof e[0]?e[0]:void 0),n="boolean"==typeof e[0]?e[0]:void 0;return "object"==typeof e[0]&&console.warn("\n      %cFCL/SDK Deprecation Notice\n      ============================\n  \n      Passing options as the first arguement to the latestBlock function has been deprecated and will be removed in future versions of the Flow JS-SDK/FCL.\n      You can learn more (including a guide on common transition paths) here: https://github.com/onflow/flow-js-sdk/blob/master/packages/sdk/TRANSITIONS.md#0007-deprecate-opts-first-arg-latest-block\n  \n      ============================\n    ","font-weight:bold;font-family:monospace;"),yn([ft(n)],t).then(kt)}function Pn(e,t){return yn([dt(e)],t).then(kt)}function wn(e){return void 0===e&&(e=[]),xe(e.map(function(e){return $(e,{role:"authorizer"})}))}function Bn(e,t,n,r){return {addr:e,signingFunction:t,keyId:n,sequenceNum:r}}function An(e){return Le("ix.validators",function(t){return Array.isArray(t)?t.push(e):[e]})}function En(e){return xe([function(t){return t.block.height=e,t},An(function(e){if("boolean"==typeof e.block.isSealed)throw new Error("Unable to specify both block height and isSealed.");if(e.block.id)throw new Error("Unable to specify both block height and block id.");return e})])}function Tn(e){return xe([function(t){return t.block.id=e,W(t)},An(function(e,t){var n=t.Ok,r=t.Bad;return ve(e)?r(e,"Unable to specify a block id with a Get Account interaction."):"boolean"==typeof e.block.isSealed?r(e,"Unable to specify both block id and isSealed."):e.block.height?r(e,"Unable to specify both block id and block height."):n(e)})])}function Nn(e,t,n){return void 0===t&&void 0===n||console.warn("\n      %cFCL/SDK Deprecation Notice\n      ============================\n  \n      Passing a start and end into getEnvents has been deprecated and will not be supported in future versions of the Flow JS-SDK/FCL.\n      You can learn more (including a guide on common transition paths) here: https://github.com/onflow/flow-js-sdk/blob/master/packages/sdk/TRANSITIONS.md#0005-deprecate-start-end-get-events-builder\n  \n      ============================\n    ","font-weight:bold;font-family:monospace;"),xe([re,function(r){return r.events.eventType=e,r.events.start=t,r.events.end=n,W(r)}])}function xn(e,t,n){return xe([re,function(r){return r.events.eventType=e,r.events.start=t,r.events.end=n,W(r)}])}function On(e,t){return void 0===t&&(t=[]),xe([re,function(n){return n.events.eventType=e,n.events.blockIds=t,W(n)}])}function _n(e){return void 0===e&&(e=null),xe([se,function(t){return t.block.isSealed=e,W(t)}])}function jn(e){return void 0===e&&(e=!1),console.warn("\n    %cFCL/SDK Deprecation Notice\n    ============================\n\n    The getLatestBlock builder has been deprecated and will be removed in future versions of the Flow JS-SDK/FCL.\n    You can learn more (including a guide on common transition paths) here: https://github.com/onflow/flow-js-sdk/blob/master/packages/sdk/TRANSITIONS.md#0006-deprecate-get-latest-block-builder\n\n    ============================\n  ","font-weight:bold;font-family:monospace;"),xe([oe,function(t){return t.block.isSealed=e,W(t)}])}function Ln(e){return console.warn("\n    %cFCL/SDK Deprecation Notice\n    ============================\n\n    The getBlockById builder has been deprecated and will be removed in future versions of the Flow JS-SDK/FCL.\n    You can learn more (including a guide on common transition paths) here: https://github.com/onflow/flow-js-sdk/blob/master/packages/sdk/TRANSITIONS.md#0004-deprecate-get-block-by-id-builder\n\n    ============================\n  ","font-weight:bold;font-family:monospace;"),xe([ie,function(t){return t.block.ids=[e],W(t)}])}function Gn(e){return console.warn("\n    %cFCL/SDK Deprecation Notice\n    ============================\n\n    The getBlockByHeight builder has been deprecated and will be removed in future versions of the Flow JS-SDK/FCL.\n    You can learn more (including a guide on common transition paths) here: https://github.com/onflow/flow-js-sdk/blob/master/packages/sdk/TRANSITIONS.md#0003-deprecate-get-block-by-height-builder\n\n    ============================\n  ","font-weight:bold;font-family:monospace;"),xe([ae,function(t){return t.block.height=e,W(t)}])}function Cn(e){return void 0===e&&(e=null),xe([le,function(t){return t.collection.id=e,t}])}function Un(e){return xe([ee,function(t){return t.transaction.id=e,W(t)}])}function Dn(e){return xe([te,function(t){return t.transaction.id=e,W(t)}])}function Rn(e){return function(t){return t.message.computeLimit=e,t}}function Kn(e){return void 0===e&&(e=[]),xe(e.map(X))}function Fn(e,t){return {value:e,xform:t}}var Hn=function(e){try{return Promise.resolve($(e,{role:"proposer"}))}catch(e){return Promise.reject(e)}},zn=function(e){try{return Promise.resolve($(e,{role:"payer"}))}catch(e){return Promise.reject(e)}};function qn(){return ue}function Jn(e){return xe([function(t){return t.message.refBlock=e,W(t)}])}function Mn(){return xe([Q,je("ix.cadence",o$1.apply(void 0,[].slice.call(arguments)))])}var Wn=[];function Yn(){return xe([Z,je("ix.cadence",o$1.apply(void 0,[].slice.call(arguments))),function(e){return e.message.computeLimit=e.message.computeLimit||10,e.message.refBlock=e.message.refBlock||null,e.authorizations=e.authorizations||Wn,W(e)}])}function Vn(){var e=[].slice.call(arguments);if(e.length>1){var t=e,n=t[0],r=t[1];return Vn(function(e,t){var o=t.Bad;return n?(0, t.Ok)(e):o(e,r)})}var o=e[0];return function(e){return o(e,{Ok:W,Bad:Y})}}var Qn=function(e){return t={name:"params",transitionsPath:"https://github.com/onflow/flow-js-sdk/blob/master/packages/sdk/TRANSITIONS.md#0001-deprecate-params"},void console.error("\n    %cFCL/SDK Deprecation Notice\n    ============================\n    The "+t.name+" builder has been removed from the Flow JS-SDK/FCL.\n    You can learn more (including a guide on common transition paths) here: "+t.transitionsPath+"\n    ============================\n  ","font-weight:bold;font-family:monospace;");var t;},Zn=function(e){return t={name:"param",transitionsPath:"https://github.com/onflow/flow-js-sdk/blob/master/packages/sdk/TRANSITIONS.md#0001-deprecate-params"},void console.warn("\n    %cFCL/SDK Deprecation Notice\n    ============================\n    The "+t.name+" builder has been deprecated and will be removed in future versions of the Flow JS-SDK/FCL.\n    You can learn more (including a guide on common transition paths) here: "+t.transitionsPath+"\n    ============================\n  ","font-weight:bold;font-family:monospace;");var t;};

    var t$3=function(t,n,e){return {label:t,asArgument:n,asInjection:e}},n$3=function(t){return Array.isArray(t)},e$2=function(t){return "object"==typeof t},r$2=function(t){return null==t},u$3=function(t){return "number"==typeof t},i$1=function(t){return Number.isInteger(t)},o$2=function(t){return "string"==typeof t},f$2=function(t){throw new Error("Type Error: "+t)},c$1=t$3("Identity",function(t){return t},function(t){return t}),a$1=t$3("UInt",function(t){if(u$3(t)&&i$1(t))return {type:"UInt",value:t.toString()};f$2("Expected Positive Integer for type Unsigned Int");},function(t){return t}),p=t$3("Int",function(t){if(u$3(t)&&i$1(t))return {type:"Int",value:t.toString()};f$2("Expected Integer for type Int");},function(t){return t}),l$2=t$3("UInt8",function(t){if(u$3(t)&&i$1(t))return {type:"UInt8",value:t.toString()};f$2("Expected integer for UInt8");},function(t){return t}),d$1=t$3("Int8",function(t){if(u$3(t)&&i$1(t))return {type:"Int8",value:t.toString()};f$2("Expected positive integer for Int8");},function(t){return t}),v$1=t$3("UInt16",function(t){if(u$3(t)&&i$1(t))return {type:"UInt16",value:t.toString()};f$2("Expected integer for UInt16");},function(t){return t}),s$1=t$3("Int16",function(t){if(u$3(t)&&i$1(t))return {type:"Int16",value:t.toString()};f$2("Expected positive integer for Int16");},function(t){return t}),y=t$3("UInt32",function(t){if(u$3(t)&&i$1(t))return {type:"UInt32",value:t.toString()};f$2("Expected integer for UInt32");},function(t){return t}),g=t$3("Int32",function(t){if(u$3(t)&&i$1(t))return {type:"Int32",value:t.toString()};f$2("Expected positive integer for Int32");},function(t){return t}),m$1=t$3("UInt64",function(t){if(u$3(t)&&i$1(t))return {type:"UInt64",value:t.toString()};f$2("Expected integer for UInt64");},function(t){return t}),I$1=t$3("Int64",function(t){if(u$3(t)&&i$1(t))return {type:"Int64",value:t.toString()};f$2("Expected positive integer for Int64");},function(t){return t}),x=t$3("UInt128",function(t){if(u$3(t)&&i$1(t))return {type:"UInt128",value:t.toString()};f$2("Expected integer for UInt128");},function(t){return t}),E$1=t$3("Int128",function(t){if(u$3(t)&&i$1(t))return {type:"Int128",value:t.toString()};f$2("Expected positive integer for Int128");},function(t){return t}),S$1=t$3("UInt256",function(t){if(u$3(t)&&i$1(t))return {type:"UInt256",value:t.toString()};f$2("Expected integer for UInt256");},function(t){return t}),U$1=t$3("Int256",function(t){if(u$3(t)&&i$1(t))return {type:"Int256",value:t.toString()};f$2("Expected integer for Int256");},function(t){return t}),A=t$3("Word8",function(t){if(u$3(t)&&i$1(t))return {type:"Word8",value:t.toString()};f$2("Expected positive number for Word8");},function(t){return t}),b$1=t$3("Word16",function(t){if(u$3(t)&&i$1(t))return {type:"Word16",value:t.toString()};f$2("Expected positive number for Word16");},function(t){return t}),W$1=t$3("Word32",function(t){if(u$3(t)&&i$1(t))return {type:"Word32",value:t.toString()};f$2("Expected positive number for Word32");},function(t){return t}),k=t$3("Word64",function(t){if(u$3(t)&&i$1(t))return {type:"Word64",value:t.toString()};f$2("Expected positive number for Word64");},function(t){return t}),F$1=function(){console.error("\n          %c@onflow/types Deprecation Notice\n          ========================\n\n          Passing in Numbers as values for Fix64 and UFix64 types is deprecated and will cease to work in future releases of @onflow/types.\n          Find out more here: https://github.com/onflow/flow-js-sdk/blob/master/packages/types/WARNINGS.md#0001-[U]Fix64-as-Number\n\n          =======================\n        ".replace(/\n\s+/g,"\n").trim(),"font-weight:bold;font-family:monospace;");},h=t$3("UFix64",function(t){return o$2(t)?{type:"UFix64",value:t}:u$3(t)?(F$1(),{type:"UFix64",value:t.toString()}):void f$2("Expected String for UFix64")},function(t){return t}),w=t$3("Fix64",function(t){return o$2(t)?{type:"Fix64",value:t}:u$3(t)?(F$1(),{type:"Fix64",value:t.toString()}):void f$2("Expected String for Fix64")},function(t){return t}),j$1=t$3("String",function(t){if(o$2(t))return {type:"String",value:t};f$2("Expected String for type String");},function(t){return t}),O$1=t$3("Character",function(t){if(o$2(t))return {type:"Character",value:t};f$2("Expected Character for type Character");},function(t){return t}),R$2=t$3("Bool",function(t){if("boolean"==typeof t)return {type:"Bool",value:t};f$2("Expected Boolean for type Bool");},function(t){return t}),N=t$3("Address",function(t){if(o$2(t))return {type:"Address",value:t};f$2("Expected Address for type Address");},function(t){return t}),B=t$3("Void",function(t){if(!t||r$2(t))return {type:"Void"};f$2("Expected Void for type Void");},function(t){return t}),C$1=function(n){return t$3("Optional",function(t){return {type:"Optional",value:r$2(t)?null:n.asArgument(t)}},function(t){return t})},D$1=t$3("Reference",function(t){if(e$2(t))return {type:"Reference",value:t};f$2("Expected Object for type Reference");},function(t){return t}),V$1=function(e){return void 0===e&&(e=[]),t$3("Array",function(t){return {type:"Array",value:n$3(e)?e.map(function(n,e){return n.asArgument(t[e])}):t.map(function(t){return e.asArgument(t)})}},function(t){return t})},P=function(r){return void 0===r&&(r=[]),t$3("Dictionary",function(t){if(e$2(t))return {type:"Dictionary",value:n$3(r)?r.map(function(n,e){return {key:n.key.asArgument(t[e].key),value:n.value.asArgument(t[e].value)}}):n$3(t)?t.map(function(t){return {key:r.key.asArgument(t.key),value:r.value.asArgument(t.value)}}):[{key:r.key.asArgument(t.key),value:r.value.asArgument(t.value)}]};f$2("Expected Object for type Dictionary");},function(t){return t})},G$1=function(r,u){return void 0===u&&(u=[]),t$3("Event",function(t){if(e$2(t))return {type:"Event",value:{id:r,fields:n$3(u)?u.map(function(n,e){return {name:t.fields[e].name,value:n.value.asArgument(t.fields[e].value)}}):t.fields.map(function(t){return {name:t.name,value:u.value.asArgument(t.value)}})}};f$2("Expected Object for type Event");},function(t){return t})},T=function(r,u){return void 0===u&&(u=[]),t$3("Resource",function(t){if(e$2(t))return {type:"Resource",value:{id:r,fields:n$3(u)?u.map(function(n,e){return {name:t.fields[e].name,value:n.value.asArgument(t.fields[e].value)}}):t.fields.map(function(t){return {name:t.name,value:u.value.asArgument(t.value)}})}};f$2("Expected Object for type Resource");},function(t){return t})},q$1=function(r,u){return void 0===u&&(u=[]),t$3("Struct",function(t){if(e$2(t))return {type:"Struct",value:{id:r,fields:n$3(u)?u.map(function(n,e){return {name:t.fields[e].name,value:n.value.asArgument(t.fields[e].value)}}):t.fields.map(function(t){return {name:t.name,value:u.value.asArgument(t.value)}})}};f$2("Expected Object for type Struct");},function(t){return t})};

    var d$2 = /*#__PURE__*/Object.freeze({
        __proto__: null,
        Address: N,
        Array: V$1,
        Bool: R$2,
        Character: O$1,
        Dictionary: P,
        Event: G$1,
        Fix64: w,
        Identity: c$1,
        Int: p,
        Int128: E$1,
        Int16: s$1,
        Int256: U$1,
        Int32: g,
        Int64: I$1,
        Int8: d$1,
        Optional: C$1,
        Reference: D$1,
        Resource: T,
        String: j$1,
        Struct: q$1,
        UFix64: h,
        UInt: a$1,
        UInt128: x,
        UInt16: v$1,
        UInt256: S$1,
        UInt32: y,
        UInt64: m$1,
        UInt8: l$2,
        Void: B,
        Word16: b$1,
        Word32: W$1,
        Word64: k,
        Word8: A,
        _Array: V$1
    });

    var r$3="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",n$4=r$3.length;function t$4(){for(var t="",a=32;a--;)t+=r$3[Math.random()*n$4|0];return t}

    Ve().put("accessNode.api","http://localhost:8080").put("challenge.handshake","http://localhost:8700/authenticate");var j$2="0.0.73",I$2=function(e){return function(t){return typeof t===e}},A$1=function(e){return null!=e},C$2=I$2("object"),k$1=I$2("string"),T$1=I$2("function"),O$2=I$2("number");function N$1(t){return T$1(t)?t(Fn,d$2):[]}var _$1=function(t){void 0===t&&(t={});try{return Promise.resolve(function(e){try{return n(A$1(e.cadence),"query({ cadence }) -- cadence is required"),n(k$1(e.cadence),"query({ cadence }) -- cadence must be a string"),Promise.resolve()}catch(e){return Promise.reject(e)}}(t)).then(function(){return yn([Mn(t.cadence),Kn(N$1(t.args||[])),t.limit&&"number"==typeof t.limit&&Rn(t.limit)]).then(bn)})}catch(e){return Promise.reject(e)}};function D$2(){return (D$2=Object.assign||function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t];for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n]);}return e}).apply(this,arguments)}function L$1(e,t){(null==t||t>e.length)&&(t=e.length);for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r];return n}function x$1(e,t){var r="undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"];if(r)return (r=r.call(e)).next.bind(r);if(Array.isArray(e)||(r=function(e,t){if(e){if("string"==typeof e)return L$1(e,t);var r=Object.prototype.toString.call(e).slice(8,-1);return "Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?L$1(e,t):void 0}}(e))||t&&e&&"number"==typeof e.length){r&&(e=r);var n=0;return function(){return n>=e.length?{done:!0}:{done:!1,value:e[n++]}}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}var z$1={f_type:"Service",f_vsn:"1.0.0"},U$2={f_type:"Identity",f_vsn:"1.0.0"},F$2={f_type:"USER",f_vsn:"1.0.0"},H$1={f_type:"PollingResponse",f_vsn:"1.0.0"},B$1={f_type:"CompositeSignature",f_vsn:"1.0.0"};function M$1(e){if(null==e)return null;switch(e.f_vsn){case"1.0.0":return e;default:return D$2({old:e},z$1,{type:"frame",endpoint:e.endpoint,params:e.params||{},data:e.data||{}})}}function J$1(e){if(null==e)return null;switch(e.f_vsn){case"1.0.0":return e;default:return D$2({},z$1,{type:"back-channel-rpc",endpoint:e.endpoint,method:e.method,params:e.params||{},data:e.data||{}})}}var G$2={"back-channel-rpc":J$1,"pre-authz":function(e){if(null==e)return null;switch(e.f_vsn){case"1.0.0":return e;default:return D$2({},z$1,{type:e.type,uid:e.id,endpoint:e.endpoint,method:e.method,identity:D$2({},U$2,{address:l$1(e.addr),keyId:e.keyId}),params:e.params,data:e.data})}},authz:function(e){if(null==e)return null;switch(e.f_vsn){case"1.0.0":return e;default:return D$2({},z$1,{type:e.type,uid:e.id,endpoint:e.endpoint,method:e.method,identity:D$2({},U$2,{address:l$1(e.addr),keyId:e.keyId}),params:e.params,data:e.data})}},authn:function(e){if(null==e)return null;switch(e.f_vsn){case"1.0.0":return e;default:return D$2({},z$1,{type:e.type,uid:e.id,endpoint:e.authn,id:e.pid,provider:{address:l$1(e.addr),name:e.name,icon:e.icon}})}},frame:M$1,"open-id":function(e){if(null==e)return null;switch(e.f_vsn){case"1.0.0":return e;default:return null}},"user-signature":function(e){if(null==e)return null;switch(e.f_vsn){case"1.0.0":return e;default:throw new Error("Invalid user-signature service")}}};function q$2(e){return r$1([e.provider.address||e.provider.name||"UNSPECIFIED",e.id]).toString("hex")}function V$2(e,t){return void 0===e&&(e=[]),e.find(function(e){return e.type===t})}function Y$1(e){var t=new URL(e.endpoint);if(t.searchParams.append("l6n",window.location.origin),null!=e.params)for(var r=0,n=Object.entries(e.params||{});r<n.length;r++){var o=n[r];t.searchParams.append(o[0],o[1]);}return t}function Z$1(e,t){void 0===t&&(t={});var r=t.method||"POST",n="GET"===r?void 0:JSON.stringify(t.data||e.data||{});return fetch(Y$1(e),{method:r,headers:D$2({},e.headers||{},t.headers||{},{"Content-Type":"application/json"}),body:n}).then(function(e){return e.json()})}function K$1(e){if(null==e)return null;switch(e.f_vsn){case"1.0.0":return e;default:return D$2({},H$1,{status:e.status,reason:e.reason,data:e.compositeSignature||e.data||{},updates:J$1(e.authorizationUpdates),local:M$1((e.local||[])[0])})}}function $$1(e){if(null==e)return null;switch(e.f_vsn){case"1.0.0":return e;default:return D$2({},B$1,{addr:n$1(e.addr||e.address),signature:e.signature||e.sig,keyId:e.keyId})}}var W$2="FCL_IFRAME",X$1=function(){},Q$1=new Set(["monetizationstart","monetizationpending","monetizationprogress","monetizationstop"]);function ee$1(e,t){if(void 0===t&&(t={}),null==e)return {send:X$1,close:X$1};var r=t.onClose||X$1,n$1=t.onMessage||X$1,o=t.onReady||X$1,i=t.onResponse||X$1;window.addEventListener("message",c);var a=function(e){n(!document.getElementById(W$2),"Attempt at triggering multiple Frames",{src:e});var t=document.createElement("iframe");return t.src=e,t.id=W$2,t.allow="usb *; hid *",t.frameBorder="0",t.style.cssText="\n  position:fixed;\n  top: 0px;\n  right: 0px;\n  bottom: 0px;\n  left: 0px;\n  height: 100vh;\n  width: 100vw;\n  display:block;\n  background:rgba(0,0,0,0.25);\n  z-index: 2147483647;\n  box-sizing: border-box;\n",document.body.append(t),[t,function(){document.getElementById(W$2)&&document.getElementById(W$2).remove();}]}(Y$1(e)),s=a[0],u=a[1];return {send:f,close:d};function c(e){try{if("object"!=typeof e.data)return;if(Q$1.has(e.data.type))return;"FCL:FRAME:CLOSE"===e.data.type&&d(),"FCL:FRAME:READY"===e.data.type&&o(e,{send:f,close:d}),"FCL:FRAME:RESPONSE"===e.data.type&&i(e,{send:f,close:d}),n$1(e,{send:f,close:d}),"FCL::CHALLENGE::RESPONSE"===e.data.type&&i(e,{send:f,close:d}),"FCL::AUTHZ_READY"===e.data.type&&o(e,{send:f,close:d}),"FCL::CHALLENGE::CANCEL"===e.data.type&&d(),"FCL::CANCEL"===e.data.type&&d();}catch(e){console.error("Frame Callback Error",e),d();}}function d(){try{window.removeEventListener("message",c),u(),r();}catch(e){console.error("Frame Close Error",e);}}function f(e){try{s.contentWindow.postMessage(JSON.parse(JSON.stringify(e||{})),"*");}catch(t){console.error("Frame Send Error",e,t);}}}var te$1,re$1=function e(t,r){void 0===r&&(r=function(){return !0});try{if(n(t,"Missing Polling Service",{service:t}),!r())throw new Error("Externally Halted");return Promise.resolve(Z$1(t,{method:oe$1(t)}).then(K$1)).then(function(t){switch(t.status){case"APPROVED":return t.data;case"DECLINED":throw new Error("Declined: "+(t.reason||"No reason supplied."));default:return Promise.resolve(new Promise(function(e){return setTimeout(e,500)})).then(function(){return e(t.updates,r)})}})}catch(e){return Promise.reject(e)}},ne$1={"HTTP/GET":"GET","HTTP/POST":"POST"},oe$1=function(e){return n(ne$1[e.method],"Invalid Service Method for type back-channel-rpc",{service:e}),ne$1[e.method]},ie$1=function(e,t,r){try{return t.data=e.data,Promise.resolve(Z$1(e,{data:t}).then(K$1)).then(function(t){if("APPROVED"===t.status)return t.data;if("DECLINED"===t.status)throw new Error("Declined: "+(t.reason||"No reason supplied."));if("PENDING"===t.status){var r=!0,n=ee$1(t.local,{onClose:function(){r=!1;}}).close;return re$1(t.updates,function(){return r}).then(function(e){return n(),$$1(e)}).catch(function(e){throw console.error(e),n(),e})}throw console.error("Auto Decline: Invalid Response",{service:e,resp:t}),new Error("Auto Decline: Invalid Response")})}catch(e){return Promise.reject(e)}},ae$1=function(e,t,r){void 0===r&&(r={});try{try{return Promise.resolve(se$1[e.method](e,t,r))}catch(n){throw console.error("execService(service, msg)",n,{service:e,msg:t,opts:r}),n}}catch(e){return Promise.reject(e)}},se$1={"HTTP/RPC":ie$1,"HTTP/POST":ie$1,"IFRAME/RPC":function(e,t,r){return new Promise(function(n,o){var i=t$4(),a=r.includeOlderJsonRpcCall;t.data=e.data,ee$1(e,{onReady:function(r,n){var o=n.send;try{o({type:"FCL:FRAME:READY:RESPONSE",body:t,service:{params:e.params,data:e.data}}),a&&o({jsonrpc:"2.0",id:i,method:"fcl:sign",params:[t,e.params]});}catch(e){throw e}},onResponse:function(e,t){var r=t.close;try{if("object"!=typeof e.data)return;var i=K$1(e.data);switch(i.status){case"APPROVED":n($$1(i.data)),r();break;case"DECLINED":o("Declined: "+(i.reason||"No reason supplied")),r();break;default:o("Declined: No reason supplied"),r();}}catch(e){throw console.error("execIframeRPC onResponse error",e),e}},onMessage:function(e,t){var r=t.close;try{if("object"!=typeof e.data)return;if("2.0"!==e.data.jsonrpc)return;if(e.data.id!==i)return;var a=K$1(e.data.result);switch(a.status){case"APPROVED":n($$1(a.data)),r();break;case"DECLINED":o("Declined: "+(a.reason||"No reason supplied")),r();break;default:o("Declined: No reason supplied"),r();}}catch(e){throw console.error("execIframeRPC onMessage error",e),e}},onClose:function(){o("Declined: Externally Halted");}});})}};function ue$1(e,t,r){if(!e.s){if(r instanceof de){if(!r.s)return void(r.o=ue$1.bind(null,e,t));1&t&&(t=r.s),r=r.v;}if(r&&r.then)return void r.then(ue$1.bind(null,e,t),ue$1.bind(null,e,2));e.s=t,e.v=r;var n=e.o;n&&n(e);}}var ce$1=function(e,t){void 0===t&&(t={});try{return we$1(),Promise.resolve(he$1(t)).then(function(t){var r=V$2(t.services,"user-signature");return n(r,"Current user must have authorized a signing service."),function(t,n){try{var o=Promise.resolve(ae$1(r,ke$1(e)));}catch(e){return n(e)}return o&&o.then?o.then(void 0,n):o}(0,function(e){console.log(e);})})}catch(e){return Promise.reject(e)}},le$1=function(e){try{return we$1(),Promise.resolve(he$1()).then(function(t){var r=V$2(t.services,"authz"),n=V$2(t.services,"pre-authz");return D$2({},e,n?{tempId:"CURRENT_USER",resolve:function(e,t){try{return Promise.resolve(ae$1(n,t)).then(je$1)}catch(e){return Promise.reject(e)}}}:{tempId:"CURRENT_USER",resolve:null,addr:n$1(r.identity.address),keyId:r.identity.keyId,sequenceNum:null,signature:null,signingFunction:function(e){try{return Promise.resolve(ae$1(r,e,{includeOlderJsonRpcCall:!0}))}catch(e){return Promise.reject(e)}}})})}catch(e){return Promise.reject(e)}},de=function(){function e(){}return e.prototype.then=function(t,r){var n=new e,o=this.s;if(o){var i=1&o?t:r;if(i){try{ue$1(n,1,i(this.v));}catch(e){ue$1(n,2,e);}return n}return this}return this.o=function(e){try{var o=e.v;1&e.s?ue$1(n,1,t?t(o):o):r?ue$1(n,1,r(o)):ue$1(n,2,o);}catch(e){ue$1(n,2,e);}},n},e}();function fe$1(e){return e instanceof de&&1&e.s}var he$1=function(e){void 0===e&&(e={});try{return Promise.resolve(new Promise(function(r,n){try{return we$1(),Promise.resolve(Ae$1()).then(function(n){if(n.loggedIn&&Re$1(n))return r(n);var o=e.serviceStrategy||ee$1;return Promise.resolve(Ve().get("discovery.wallet")).then(function(e){function n(e){o({endpoint:e},{onReady:function(e,t){var r=t.send;try{return Promise.resolve(pe$1(/^service\./)).then(function(e){return Promise.resolve(pe$1(/^app\.detail\./)).then(function(t){r({type:"FCL:AUTHN:CONFIG",services:e,app:t});})})}catch(e){return Promise.reject(e)}},onClose:function(){try{return Promise.resolve(Ae$1()).then(function(e){r(e);})}catch(e){return Promise.reject(e)}},onResponse:function(e,t){var n=t.close;try{return Promise.resolve(function(e){try{var t=(e=function(e){return e.addr=e.addr?l$1(e.addr):null,e.paddr=e.paddr?l$1(e.paddr):null,e}(e)).services||[];return Promise.resolve(function(e,t){try{if(null==e||null==t)return Promise.resolve([]);var r=new URL(e);return r.searchParams.append("code",t),Promise.resolve(fetch(r,{method:"GET",headers:{"Content-Type":"application/json"}}).then(function(e){return e.json()})).then(function(e){if(Array.isArray(e))return e;var t=[];if(Array.isArray(e.authorizations))for(var r,n=x$1(e.authorizations);!(r=n()).done;)t.push(D$2({type:"authz",keyId:e.keyId},r.value));return null!=e.provider&&t.push(D$2({type:"authn",id:"wallet-provider#authn"},e.provider)),t})}catch(e){return Promise.reject(e)}}(e.hks,e.code)).then(function(r){var n,o,i=(n=t,o=r,void 0===n&&(n=[]),void 0===o&&(o=[]),[].concat(n,o)).map(function(t){return function(e,t){try{return G$2[e.type](e,t)}catch(t){return console.error("Unrecognized FCL Service Type ["+e.type+"]",e,t),e}}(t,e)}),a=function(e,t){return t.find(function(e){return "authn"===e.type})}(0,i);return D$2({},F$2,{addr:l$1(e.addr),cid:q$2(a),loggedIn:!0,services:i,expiresAt:e.exp})})}catch(e){return Promise.reject(e)}}(e.data)).then(function(e){return b(me$1,ye$1,e),Promise.resolve(Ae$1()).then(function(e){r(e),n();})})}catch(e){return Promise.reject(e)}}});}return e?n(e):Promise.resolve(Ve().get("challenge.handshake")).then(n)})})}catch(e){return Promise.reject(e)}}))}catch(e){return Promise.reject(e)}},pe$1=function(e){try{return Promise.resolve(Ve().where(e)).then(function(t){return Object.fromEntries(Object.entries(t).map(function(t){var r=t[1];return [t[0].replace(e,""),r]}))})}catch(e){return Promise.reject(e)}},me$1="CURRENT_USER",ve$1="CURRENT_USER/UPDATED",ye$1="SET_CURRENT_USER",Pe$1='{\n  "f_type": "User",\n  "f_vsn": "1.0.0",\n  "addr":null,\n  "cid":null,\n  "loggedIn":null,\n  "expiresAt":null,\n  "services":[]\n}',ge$1=function(e){try{return sessionStorage.setItem(me$1,JSON.stringify(e)),Promise.resolve(e)}catch(e){return Promise.reject(e)}},Ee$1=function(){return Ve().get("persistSession",!0)},be$1=((te$1={})[c]=function(e){try{return e.merge(JSON.parse(Pe$1)),Promise.resolve(Ee$1()).then(function(t){var r=function(){if(t)return Promise.resolve(function(){try{var e=JSON.parse(Pe$1),t=JSON.parse(sessionStorage.getItem(me$1));return null!=t&&e.f_vsn!==t.f_vsn?(sessionStorage.removeItem(me$1),Promise.resolve(e)):Promise.resolve(t||e)}catch(e){return Promise.reject(e)}}()).then(function(t){Re$1(t)&&e.merge(t);})}();if(r&&r.then)return r.then(function(){})})}catch(e){return Promise.reject(e)}},te$1[f]=function(e,t){e.subscribe(t.from),e.send(t.from,ve$1,D$2({},e.all()));},te$1[s]=function(e,t){e.unsubscribe(t.from);},te$1.SNAPSHOT=function(e,t){try{return t.reply(D$2({},e.all())),Promise.resolve()}catch(e){return Promise.reject(e)}},te$1[ye$1]=function(e,t,r){try{return e.merge(r),Promise.resolve(Ee$1()).then(function(t){t&&ge$1(e.all()),e.broadcast(ve$1,D$2({},e.all()));})}catch(e){return Promise.reject(e)}},te$1.DEL_CURRENT_USER=function(e,t){try{return e.merge(JSON.parse(Pe$1)),Promise.resolve(Ee$1()).then(function(t){t&&ge$1(e.all()),e.broadcast(ve$1,D$2({},e.all()));})}catch(e){return Promise.reject(e)}},te$1),we$1=function(){return m(be$1,me$1)};function Re$1(e){return null==e.expiresAt||0===e.expiresAt||e.expiresAt>Date.now()}function Se$1(){we$1(),b(me$1,"DEL_CURRENT_USER");}function je$1(e){var t=function(e){return {f_type:"PreAuthzResponse",f_vsn:"1.0.0",proposer:(e||{}).proposer,payer:(e||{}).payer||[],authorization:(e||{}).authorization||[]}}(e),r=[];null!=t.proposer&&r.push(["PROPOSER",t.proposer]);for(var n,o=x$1(t.payer||[]);!(n=o()).done;)r.push(["PAYER",n.value]);for(var i,a=x$1(t.authorization||[]);!(i=a()).done;)r.push(["AUTHORIZER",i.value]);return r.map(function(e){var t=e[0],r=e[1];return {tempId:[r.identity.address,r.identity.keyId].join("|"),addr:r.identity.address,keyId:r.identity.keyId,signingFunction:function(e){return ae$1(r,e)},role:{proposer:"PROPOSER"===t,payer:"PAYER"===t,authorizer:"AUTHORIZER"===t}}})}function Ie$1(e){we$1();var t="@EXIT",r=m(function(r){try{var n;return r.send(me$1,f),Promise.resolve(function(e,t,r){for(var n;;){var o=e();if(fe$1(o)&&(o=o.v),!o)return i;if(o.then){n=0;break}var i=r();if(i&&i.then){if(!fe$1(i)){n=1;break}i=i.s;}}var a=new de,s=ue$1.bind(null,a,2);return (0===n?o.then(c):1===n?i.then(u):(void 0).then(function(){(o=e())?o.then?o.then(c).then(void 0,s):c(o):ue$1(a,1,i);})).then(void 0,s),a;function u(t){i=t;do{if(!(o=e())||fe$1(o)&&!o.v)return void ue$1(a,1,i);if(o.then)return void o.then(c).then(void 0,s);fe$1(i=r())&&(i=i.v);}while(!i||!i.then);i.then(u).then(void 0,s);}function c(e){e?(i=r())&&i.then?i.then(u).then(void 0,s):u(i):ue$1(a,1,i);}}(function(){return !n&&1},0,function(){return Promise.resolve(r.receive()).then(function(o){if(o.tag===t)return r.send(me$1,s),void(n=1);e(o.data);})}))}catch(e){return Promise.reject(e)}});return function(){return b(r,t)}}function Ae$1(){return we$1(),b(me$1,"SNAPSHOT",null,{expectReply:!0,timeout:0})}var Ce$1,ke$1=function(e){return n(/^[0-9a-f]+$/i.test(e),"Message must be a hex string"),{message:e}},Te$1=function(){return {authenticate:he$1,unauthenticate:Se$1,authorization:le$1,signUserMessage:ce$1,subscribe:Ie$1,snapshot:Ae$1}},Oe$1=function(e){try{return Promise.resolve(yn([Un(e)]).then(bn))}catch(e){return Promise.reject(e)}},Ne$1=function(e){return e.status>=4},_e$1=function(e){return e.status>=3},De$1=function(e){return e.status>=2},Le$1=((Ce$1={})[c]=function(e){try{return Promise.resolve(Oe$1(e.self())).then(function(t){Ne$1(t)||setTimeout(function(){return e.sendSelf("POLL")},2500),e.merge(t);})}catch(e){return Promise.reject(e)}},Ce$1[f]=function(e,t){e.subscribe(t.from),e.send(t.from,a,e.all());},Ce$1[s]=function(e,t){e.unsubscribe(t.from);},Ce$1[l]=function(e,t){try{return t.reply(e.all()),Promise.resolve()}catch(e){return Promise.reject(e)}},Ce$1.POLL=function(e){try{return Promise.resolve(Oe$1(e.self())).then(function(t){var r,n;Ne$1(t)||setTimeout(function(){return e.sendSelf("POLL")},2500),r=e.all(),n=t,JSON.stringify(r)!==JSON.stringify(n)&&e.broadcast(a,t),e.merge(t);})}catch(e){return Promise.reject(e)}},Ce$1),xe$1=function(e){if("object"==typeof e&&(e=e.transactionId),null==e)throw new Error("transactionId required");return e},ze$1=function(e){return m(Le$1,xe$1(e))};function Ue$1(e){function t(t){return I(xe$1(e),ze$1,t)}function r(e){return function(r){void 0===r&&(r={});var n=r.suppress||!1;return new Promise(function(r,o){var i=t(function(t){t.statusCode&&!n?(o(t.errorMessage),i()):e(t)&&(r(t),i());});})}}return {snapshot:function(){return E(e,ze$1)},subscribe:t,onceFinalized:r(De$1),onceExecuted:r(_e$1),onceSealed:r(Ne$1)}}Ue$1.isUnknown=function(e){return e.status>=0},Ue$1.isPending=function(e){return e.status>=1},Ue$1.isFinalized=De$1,Ue$1.isExecuted=_e$1,Ue$1.isSealed=Ne$1,Ue$1.isExpired=function(e){return 5===e.status};var Fe$1,He$1=function(t){void 0===t&&(t={});try{return Promise.resolve(function(r,n$1){try{var o=Promise.resolve(function(e){try{return n(A$1(e),"mutate(opts) -- opts is required"),n(C$2(e),"mutate(opts) -- opts must be an object"),n(A$1(e.cadence),"mutate({ cadence }) -- cadence is required"),n(k$1(e.cadence),"mutate({ cadence }) -- cadence must be a string"),Promise.resolve()}catch(e){return Promise.reject(e)}}(t)).then(function(){return Promise.resolve(Ve().get("fcl.authz",Te$1().authorization)).then(function(r){return yn([Yn(t.cadence),Kn(N$1(t.args||[])),t.limit&&O$2(t.limit)&&Rn(t.limit),Hn(t.proposer||t.authz||r),zn(t.payer||t.authz||r),wn(t.authorizations||[t.authz||r])]).then(bn)})});}catch(e){return n$1(e)}return o&&o.then?o.then(void 0,n$1):o}(0,function(e){throw e}))}catch(e){return Promise.reject(e)}},Be$1=function(e,r){void 0===e&&(e=[]),void 0===r&&(r={});try{return Promise.resolve(Ve().get("sdk.resolve",r.resolve||vn(r))).then(function(t){function r(){return Promise.resolve(t(e)).then(function(e){return JSON.stringify(an(e),null,2)})}var n=function(){if(Array.isArray(e))return Promise.resolve(xe(F(),e)).then(function(t){e=t;})}();return n&&n.then?n.then(r):r()})}catch(e){return Promise.reject(e)}},Me$1=function(e){try{var r=setTimeout;return Promise.resolve(Ve().get("fcl.eventPollRate",1e4)).then(function(t){return r(function(){return e.sendSelf("TICK")},t)})}catch(e){return Promise.reject(e)}},Je$1=((Fe$1={}).TICK=function(e){try{if(!e.hasSubs())return Promise.resolve();var t=e.get("hwm"),n=function(){if(null==t){var n=e.put;return Promise.resolve(Sn()).then(function(t){n.call(e,"hwm",t);var r=e.put;return Promise.resolve(Me$1(e)).then(function(t){r.call(e,"tick",t);})})}return Promise.resolve(Sn()).then(function(n){return e.put("hwm",n),Promise.resolve(yn([getEvents(e.self(),t.height,n.height-1)]).then(bn)).then(function(t){for(var r,n=x$1(t);!(r=n()).done;)e.broadcast("UPDATED",r.value.data);var o=e.put;return Promise.resolve(Me$1(e)).then(function(t){o.call(e,"tick",t);})})})}();return Promise.resolve(n&&n.then?n.then(function(){}):void 0)}catch(e){return Promise.reject(e)}},Fe$1[f]=function(e,t){try{var r=function(){e.subscribe(t.from);},n=function(){if(!e.hasSubs()){var t=e.put;return Promise.resolve(Me$1(e)).then(function(r){t.call(e,"tick",r);})}}();return Promise.resolve(n&&n.then?n.then(r):r())}catch(e){return Promise.reject(e)}},Fe$1[s]=function(e,t){e.unsubscribe(t.from),e.hasSubs()||(clearTimeout(e.get("tick")),e.delete("tick"),e.delete("hwm"));},Fe$1),Ge=function(e){return m(Je$1,e)};function qe$1(e){return {subscribe:function(t){return I(e,Ge,t)}}}var Ve$1=function(e){return Te$1().authenticate(e)},Ye$1=function(){return Te$1().unauthenticate()},Ze$1=function(){return Te$1().unauthenticate(),Te$1().authenticate()},Ke$1=function(e){return Te$1().authenticate()},$e$1=function(e){return Te$1().authenticate()},We$1=Te$1().authorization,Xe$1=d$2;

    var fcl = /*#__PURE__*/Object.freeze({
        __proto__: null,
        VERSION: j$2,
        authenticate: Ve$1,
        authz: We$1,
        currentUser: Te$1,
        events: qe$1,
        logIn: $e$1,
        mutate: He$1,
        query: _$1,
        reauthenticate: Ze$1,
        serialize: Be$1,
        signUp: Ke$1,
        t: Xe$1,
        tx: Ue$1,
        unauthenticate: Ye$1,
        account: Pn,
        arg: Fn,
        args: Kn,
        atBlockHeight: En,
        atBlockId: Tn,
        authorization: Bn,
        authorizations: wn,
        build: Ce,
        config: Ve,
        createSignableVoucher: an,
        decode: bn,
        getAccount: dt,
        getBlock: ft,
        getBlockByHeight: Gn,
        getBlockById: Ln,
        getBlockHeader: _n,
        getCollection: Cn,
        getEvents: Nn,
        getEventsAtBlockHeightRange: xn,
        getEventsAtBlockIds: On,
        getLatestBlock: jn,
        getTransaction: Dn,
        getTransactionStatus: Un,
        invariant: Vn,
        isBad: Ee,
        isOk: Ae,
        latestBlock: Sn,
        limit: Rn,
        param: Zn,
        params: Qn,
        payer: zn,
        ping: qn,
        pipe: xe,
        proposer: Hn,
        ref: Jn,
        script: Mn,
        send: yn,
        transaction: Yn,
        validator: An,
        why: Te,
        display: u$1,
        sansPrefix: n$1,
        withPrefix: l$1,
        cadence: o$1,
        cdc: o$1
    });

    /* Hello.svelte generated by Svelte v3.42.6 */
    const file = "Hello.svelte";

    function create_fragment(ctx) {
    	let button;
    	let t0_value = (/*message*/ ctx[0] ? "Well done!" : "Click this") + "";
    	let t0;
    	let t1;
    	let div;
    	let t2;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			button = element("button");
    			t0 = text(t0_value);
    			t1 = space();
    			div = element("div");
    			t2 = text(/*message*/ ctx[0]);
    			button.disabled = /*message*/ ctx[0];
    			attr_dev(button, "class", "svelte-1dobccl");
    			toggle_class(button, "clicked", /*message*/ ctx[0]);
    			add_location(button, file, 32, 0, 581);
    			set_style(div, "margin-top", "1rem");
    			add_location(div, file, 36, 0, 712);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, button, anchor);
    			append_dev(button, t0);
    			insert_dev(target, t1, anchor);
    			insert_dev(target, div, anchor);
    			append_dev(div, t2);

    			if (!mounted) {
    				dispose = listen_dev(button, "click", /*handleClick*/ ctx[1], false, false, false);
    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*message*/ 1 && t0_value !== (t0_value = (/*message*/ ctx[0] ? "Well done!" : "Click this") + "")) set_data_dev(t0, t0_value);

    			if (dirty & /*message*/ 1) {
    				prop_dev(button, "disabled", /*message*/ ctx[0]);
    			}

    			if (dirty & /*message*/ 1) {
    				toggle_class(button, "clicked", /*message*/ ctx[0]);
    			}

    			if (dirty & /*message*/ 1) set_data_dev(t2, /*message*/ ctx[0]);
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(button);
    			if (detaching) detach_dev(t1);
    			if (detaching) detach_dev(div);
    			mounted = false;
    			dispose();
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('Hello', slots, []);
    	Ve().put("accessNode.api", "https://access-testnet.onflow.org");
    	let message = "";

    	async function handleClick() {
    		$$invalidate(0, message = "Waiting for Flow ...");

    		$$invalidate(0, message = await _$1({
    			cadence: `
											pub fun main(): String {
															return "Hello from Flow!";
												}
										`
    		}));
    	}

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<Hello> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ fcl, message, handleClick });

    	$$self.$inject_state = $$props => {
    		if ('message' in $$props) $$invalidate(0, message = $$props.message);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [message, handleClick];
    }

    class Hello extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Hello",
    			options,
    			id: create_fragment.name
    		});
    	}
    }

    /* App.svelte generated by Svelte v3.42.6 */
    const file$1 = "App.svelte";

    function create_fragment$1(ctx) {
    	let main;
    	let h1;
    	let t1;
    	let hello;
    	let current;
    	hello = new Hello({ $$inline: true });

    	const block = {
    		c: function create() {
    			main = element("main");
    			h1 = element("h1");
    			h1.textContent = "Hello Flow + Svelte";
    			t1 = space();
    			create_component(hello.$$.fragment);
    			add_location(h1, file$1, 12, 1, 149);
    			attr_dev(main, "class", "svelte-1na4wt1");
    			add_location(main, file$1, 11, 0, 141);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			append_dev(main, h1);
    			append_dev(main, t1);
    			mount_component(hello, main, null);
    			current = true;
    		},
    		p: noop,
    		i: function intro(local) {
    			if (current) return;
    			transition_in(hello.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(hello.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			destroy_component(hello);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots('App', slots, []);
    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== '$$' && key !== 'slot') console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ Hello });
    	return [];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment$1.name
    		});
    	}
    }

    const app = new App({
      target: document.body
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map
