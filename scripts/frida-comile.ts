import frida from "frida";
import path from "path";
import decompress from "decompress";
import decompressTargz from "decompress-targz";

const compiler = new frida.Compiler();

const FRIDA_VERSION = "17.5.1";
const NAPI_VERSION = "napi-v8";
const PLATFORM = process.platform;
const ARCH = process.arch;

const BINDING_PATH = path.join(process.cwd(), "node_modules", "frida", "build", "frida_binding.node");

async function downloadFridaBinding() {
  console.log("Downloading frida binding...");
  const FILE_NAME = `frida-v${FRIDA_VERSION}-${NAPI_VERSION}-${PLATFORM}-${ARCH}.tar.gz`;
  const DOWNLOAD_URL = `https://github.com/frida/frida/releases/download/${FRIDA_VERSION}/${FILE_NAME}`;  

  const response = await fetch(DOWNLOAD_URL);
  const buffer = await response.arrayBuffer();

  const file = Bun.file(BINDING_PATH);
  await file.write(buffer);

  await decompress(BINDING_PATH, {
    plugins: [decompressTargz()],
  });
  console.log("Downloaded frida binding");
}

if (!Bun.file(BINDING_PATH).exists) {
  await downloadFridaBinding();
}

compiler.starting.connect(() => {
  console.log("Compiling...");
});

compiler.finished.connect(() => {
  console.log("Compiled");
});

compiler.diagnostics.connect((diagnostics) => {
  for (const diag of diagnostics) {
    console.log(diag);
  }
});

const bundle = await compiler.build("src-frida/index.ts", {
  projectRoot: process.cwd(),
  outputFormat: "unescaped",
  bundleFormat: "esm",
  typecheck: "full"
});

const file = Bun.file(path.join("src-frida", "dist", "index.js"));

Bun.write(file, bundle, { createPath: true });