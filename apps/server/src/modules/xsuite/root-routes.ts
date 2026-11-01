/**
 * The routes the PRODUCTION root modules serve (P06.13.02, LG-P01).
 *
 * The cross-tenant suite used to build its app from a module list typed into the test, so a new
 * module added to `ApiRootModule` was invisible to it and the "100 % route coverage" figure stayed
 * green. This reads the real roots instead: it walks `imports` from each root, collects every
 * controller class, and composes `METHOD /path` from the same Nest metadata the router reads.
 * Nothing is booted, so it needs no database and no configuration.
 */

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner } from '@nestjs/core';

type Constructor = abstract new (...args: never[]) => unknown;

interface DynamicModuleLike {
  readonly module: Constructor;
  readonly imports?: readonly unknown[] | undefined;
  readonly controllers?: readonly Constructor[] | undefined;
}

function isDynamic(value: unknown): value is DynamicModuleLike {
  return typeof value === 'object' && value !== null && 'module' in value;
}

function isForwardRef(value: unknown): value is { forwardRef: () => unknown } {
  return typeof value === 'object' && value !== null && 'forwardRef' in value;
}

function paths(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((entry) => paths(entry));
  return [typeof value === 'string' ? value : '/'];
}

function join(...segments: string[]): string {
  const joined = `/${segments.join('/')}`.replace(/\/{2,}/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

/** Every controller class reachable from `roots` through `imports`, each module visited once. */
export function controllersReachableFrom(roots: readonly unknown[]): Set<Constructor> {
  const controllers = new Set<Constructor>();
  const seen = new Set<unknown>();
  const visit = (entry: unknown): void => {
    const resolved = isForwardRef(entry) ? entry.forwardRef() : entry;
    if (resolved === undefined || resolved === null || seen.has(resolved)) return;
    seen.add(resolved);
    const moduleClass = (isDynamic(resolved) ? resolved.module : resolved) as Constructor;
    const read = (key: string): unknown[] => {
      const own = (Reflect.getMetadata(key, moduleClass) as unknown[] | undefined) ?? [];
      const extra = isDynamic(resolved)
        ? ((resolved as unknown as Record<string, unknown[] | undefined>)[key] ?? [])
        : [];
      return [...own, ...extra];
    };
    for (const controller of read(MODULE_METADATA.CONTROLLERS)) {
      controllers.add(controller as Constructor);
    }
    for (const imported of read(MODULE_METADATA.IMPORTS)) visit(imported);
  };
  for (const root of roots) visit(root);
  return controllers;
}

/** `METHOD /path` for every handler of `controller` and its base classes, from the decorators' own metadata. */
export function routesOfController(controller: Constructor): string[] {
  const prototype = (controller as unknown as { prototype: Record<string, unknown> }).prototype;
  const prefixes = paths(Reflect.getMetadata(PATH_METADATA, controller));
  const routes: string[] = [];
  // Nest mounts decorated methods inherited from base controllers too, so the scan walks the
  // whole prototype chain with the scanner the router itself uses. `prototype[name]` resolves
  // an override to the subclass method, and an undecorated override carries no route metadata
  // and is skipped, exactly as the router does (P06.13.02, G12 review round 1).
  for (const name of new MetadataScanner().getAllMethodNames(prototype)) {
    const handler = prototype[name];
    if (typeof handler !== 'function') continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    if (method === undefined) continue;
    const verb = RequestMethod[method];
    for (const prefix of prefixes) {
      for (const path of paths(Reflect.getMetadata(PATH_METADATA, handler))) {
        routes.push(`${verb} ${join(prefix, path)}`);
      }
    }
  }
  return routes;
}

/** The set of routes the given root modules serve. HEAD and OPTIONS are not product routes. */
export function routesServedBy(roots: readonly unknown[]): Set<string> {
  const served = new Set<string>();
  for (const controller of controllersReachableFrom(roots)) {
    for (const route of routesOfController(controller)) {
      if (!route.startsWith('HEAD ') && !route.startsWith('OPTIONS ')) served.add(route);
    }
  }
  return served;
}

/** Routes the roots serve that the inventory does not list, and inventory rows nothing serves. */
export function compareWithInventory(
  served: ReadonlySet<string>,
  inventoried: ReadonlySet<string>,
): { unprobed: string[]; orphaned: string[] } {
  return {
    unprobed: [...served].filter((route) => !inventoried.has(route)).sort(),
    orphaned: [...inventoried].filter((route) => !served.has(route)).sort(),
  };
}
