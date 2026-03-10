import { build, release } from "@titanpl/packet";

export async function buildCommand(isRelease = false) {
  const buildFn = isRelease ? release : build;
  const dist = await buildFn(process.cwd());
  console.log(`✔ ${isRelease ? 'Release' : 'Build'} complete →`, dist);
}