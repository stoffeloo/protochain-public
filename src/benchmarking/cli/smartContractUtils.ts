import * as path from "node:path";
import type { ContractMetadata, ContractModule } from "../../core/types";
import type { SmartContractMethodConfig } from "../types";

export type LoadedContractArtifact = {
  module: ContractModule<any>;
  metadata: ContractMetadata;
};

export async function loadContractArtifact(contractPath: string): Promise<LoadedContractArtifact> {
  const fullPath = path.resolve(contractPath);

  const findModule = (moduleObj: any): ContractModule<any> | undefined => {
    if (moduleObj.default) return moduleObj.default;

    const key = Object.keys(moduleObj).find(k => {
      const val = moduleObj[k];
      return val && typeof val === "object" && "name" in val && "methods" in val && "initialState" in val;
    });

    return key ? moduleObj[key] : undefined;
  };

  const findMetadata = (moduleObj: any): ContractMetadata | undefined => {
    if (moduleObj.contractMetadata && typeof moduleObj.contractMetadata === "object") {
      return moduleObj.contractMetadata as ContractMetadata;
    }
    if (moduleObj.metadata && typeof moduleObj.metadata === "object") {
      return moduleObj.metadata as ContractMetadata;
    }

    const key = Object.keys(moduleObj).find(k => {
      const val = moduleObj[k];
      return (
        val &&
        typeof val === "object" &&
        typeof val.hash === "string" &&
        typeof val.seqName === "string" &&
        typeof val.methods === "object" &&
        Array.isArray(val.nonCommutativeOperations) &&
        Array.isArray(val.idempotentOperations) &&
        Array.isArray(val.constructiveOperations) &&
        Array.isArray(val.supersedeOperations) &&
        Array.isArray(val.dependentOperations)
      );
    });

    return key ? (moduleObj[key] as ContractMetadata) : undefined;
  };

  if (fullPath.endsWith(".ts")) {
    try {
      const moduleObj = await import(fullPath);
      const contractModule = findModule(moduleObj);
      const metadata = findMetadata(moduleObj);
      if (!contractModule) {
        throw new Error(`Could not find a ContractModule export in ${contractPath}. Export a default ContractModule or a named export with name, methods, and initialState.`);
      }
      if (!metadata) {
        throw new Error(`Could not find a ContractMetadata export in ${contractPath}. Export 'contractMetadata' (or 'metadata').`);
      }
      return { module: contractModule, metadata };
    } catch (e) {
      throw new Error(`Failed to load contract module from ${contractPath}: ${e}`);
    }
  } else if (fullPath.endsWith(".js")) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const moduleObj = require(fullPath);
      const contractModule = findModule(moduleObj);
      const metadata = findMetadata(moduleObj);
      if (!contractModule) {
        throw new Error(`Could not find a ContractModule export in ${contractPath}. Export a default ContractModule or a named export with name, methods, and initialState.`);
      }
      if (!metadata) {
        throw new Error(`Could not find a ContractMetadata export in ${contractPath}. Export 'contractMetadata' (or 'metadata').`);
      }
      return { module: contractModule, metadata };
    } catch (e) {
      throw new Error(`Failed to load contract module from ${contractPath}: ${e}`);
    }
  }

  throw new Error(`Contract file must be a .ts or .js file, got: ${contractPath}`);
}

export function parseMethods(methodsStr: any): SmartContractMethodConfig[] {
  if (typeof methodsStr !== "string") {
    throw new Error("--methods is required and must be a JSON string");
  }

  try {
    const methods = JSON.parse(methodsStr);
    if (!Array.isArray(methods)) {
      throw new Error("--methods must be a JSON array");
    }

    return methods.map((m: any) => {
      const normalCount = typeof m?.normalCount === "number"
        ? m.normalCount
        : typeof m?.count === "number"
          ? m.count
          : undefined;
      const forceFailedCount = typeof m?.forceFailedCount === "number" ? m.forceFailedCount : 0;

      if (typeof m !== "object" || m === null || !m.method || typeof normalCount !== "number") {
        throw new Error("Each method must have 'method' (string) and 'normalCount' (number) properties");
      }
      return {
        method: String(m.method),
        normalCount,
        forceFailedCount,
        params: m.params,
        value: m.value,
      };
    });
  } catch (e) {
    throw new Error(`Invalid --methods JSON: ${e}`);
  }
}

//ai generated function
export async function loadNamedExport<T>(modulePath: string, exportName: string): Promise<T> {
  const fullPath = path.resolve(modulePath);

  try {
    let module: any;
    if (fullPath.endsWith(".ts")) {
      module = await import(fullPath);
    } else if (fullPath.endsWith(".js")) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      module = require(fullPath);
    } else {
      throw new Error(`Module file must be a .ts or .js file, got: ${modulePath}`);
    }

    if (!(exportName in module)) {
      throw new Error(`Export '${exportName}' not found in ${modulePath}`);
    }

    return module[exportName] as T;
  } catch (e) {
    throw new Error(`Failed to load export '${exportName}' from ${modulePath}: ${e}`);
  }
}
