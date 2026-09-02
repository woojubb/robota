import { resolveWorkspaceCapability } from './workspace-operation-registry.mjs';
import { addReason, transitiveClosure } from './workspace-plan-shapes.mjs';

function failure(reason) {
  return { failure: reason };
}

function selectRegisteredTypechecks({ ownerNames, byName, registry, reasons }) {
  const registered = new Set();
  for (const owner of ownerNames) {
    const integrations = registry[owner] ?? [];
    if (!Array.isArray(integrations)) {
      return failure(`typecheck integration owner registry is unreadable for ${owner}`);
    }
    for (const integration of integrations) {
      const candidate = byName.get(integration);
      if (!candidate) {
        return failure(
          `unknown typecheck integration owner ${integration} registered for ${owner}`,
        );
      }
      if (resolveWorkspaceCapability(candidate, 'typecheck').kind !== 'script') {
        return failure(
          `typecheck integration owner ${integration} has no real typecheck capability`,
        );
      }
      registered.add(integration);
      addReason(reasons, integration, `typecheck-integration-owner-for:${owner}`);
    }
  }
  return { selectedNames: new Set([...ownerNames, ...registered]) };
}

function selectTestIntegrations({ ownerNames, byName, registry, reasons }) {
  const registered = new Set();
  for (const owner of ownerNames) {
    const integrations = registry[owner] ?? [];
    if (!Array.isArray(integrations)) {
      return failure(`integration owner registry is unreadable for ${owner}`);
    }
    for (const integration of integrations) {
      const candidate = byName.get(integration);
      if (!candidate)
        return failure(`unknown integration owner ${integration} registered for ${owner}`);
      if (resolveWorkspaceCapability(candidate, 'test').kind !== 'script') {
        return failure(`integration owner ${integration} has no real test capability`);
      }
      registered.add(integration);
      addReason(reasons, integration, `integration-owner-for:${owner}`);
    }
  }
  return { selectedNames: new Set([...ownerNames, ...registered]) };
}

export function selectPackagesForOperation(context) {
  const { operation, ownerNames, dependencies, dependents, byName, reasons } = context;
  let dependencyNames = new Set();
  let dependentNames = new Set();
  let selectedNames = new Set(ownerNames);
  if (operation === 'build') {
    dependencyNames = transitiveClosure(ownerNames, dependencies);
    selectedNames = new Set([...ownerNames, ...dependencyNames]);
  } else if (operation === 'consumer-build') {
    dependentNames = transitiveClosure(ownerNames, dependents);
    const consumers = new Set([...ownerNames, ...dependentNames]);
    dependencyNames = transitiveClosure(consumers, dependencies);
    selectedNames = new Set([...consumers, ...dependencyNames]);
  } else if (operation === 'typecheck') {
    const result = selectRegisteredTypechecks({
      ...context,
      registry: context.typecheckIntegrationOwners,
    });
    if (result.failure) return result;
    selectedNames = result.selectedNames;
  } else if (operation === 'test') {
    const result = selectTestIntegrations({ ...context, registry: context.integrationOwners });
    if (result.failure) return result;
    selectedNames = result.selectedNames;
  } else if (operation === 'examples-typecheck') {
    selectedNames = new Set(
      [...ownerNames].filter((name) => byName.get(name).directory.startsWith('examples/')),
    );
  }
  for (const name of dependencyNames) {
    addReason(reasons, name, `dependency-of:${[...ownerNames].sort().join(',')}`);
  }
  for (const name of dependentNames) {
    addReason(reasons, name, `dependent-of:${[...ownerNames].sort().join(',')}`);
  }
  return { selectedNames, dependencyNames, dependentNames };
}
