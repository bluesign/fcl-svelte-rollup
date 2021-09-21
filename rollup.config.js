// This file will not affect the sandbox but will
// affect the deployment and dowload

import svelte from "rollup-plugin-svelte";
import resolve from "rollup-plugin-node-resolve";
import commonjs from "rollup-plugin-commonjs";
import { terser } from "rollup-plugin-terser";
import builtins from 'rollup-plugin-node-builtins';
import globals from 'rollup-plugin-node-globals';


const production = !process.env.ROLLUP_WATCH;

export default {
  input: "index.js",
  output: {
    sourcemap: true,
    format: "iife",
    name: "app",
    file: "public/bundle.js"
  },
  plugins: [
    svelte({
      // enable run-time checks when not in production
      dev: !production,
      // we'll extract any component CSS out into
        //
      // a separate file — better for performance
      css: (css) => {
        css.write("public/bundle.css");
      }
    }),
    builtins(),
    // If you have external dependencies installed from
    // npm, you'll most likely need these plugins. In
    // some cases you'll need additional configuration —
    // consult the documentation for details:
    // https://github.com/rollup/rollup-plugin-commonjs
    resolve({
    }),
    commonjs({
        namedExports:{
            "@improbable-eng/grpc-web": ["grpc"],
            "@onflow/protobuf": ["Transaction","SendTransactionRequest","AccessAPI", "GetTransactionRequest","ExecuteScriptAtBlockIDRequest","ExecuteScriptAtBlockHeightRequest","ExecuteScriptAtLatestBlockRequest","GetAccountAtBlockHeightRequest","GetAccountAtLatestBlockRequest","GetEventsForHeightRangeRequest","GetEventsForBlockIDsRequest","GetLatestBlockRequest","GetBlockByIDRequest","GetBlockByHeightRequest","GetBlockHeaderByIDRequest","GetBlockHeaderByHeightRequest","GetLatestBlockHeaderRequest","GetCollectionByIDRequest","PingRequest"]
        }
        
    }),
    globals(),

    // If we're building for production (npm run build
    // instead of npm run dev), minify
    production && terser()
  ]
};
