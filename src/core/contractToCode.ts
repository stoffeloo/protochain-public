import { ContractMethodDefinition, ContractModule, ContractState } from "./types";

/**
 * IMPORTANT:
 * - spec.run MUST be a plain function that does not reference outer-scope variables,
 *   because it will be serialized with .toString() and evaluated in a fresh Function().
 * - initialState must also be JSON-serializable.
 */
export function contractToCode<S extends ContractState>(module: ContractModule<S>): string {
  const methods = Object.entries(module.methods)
    .map(([name, spec]: [string, ContractMethodDefinition<S>]) => {
      const run = spec.run.toString();
      return `${JSON.stringify(name)}: { run: ${run} }`;
    })
    .join(",\n");

  return `({
    name: ${JSON.stringify(module.name)},
    initialState: ${JSON.stringify(module.initialState)},
    methods: { ${methods} }
  })`;
}
