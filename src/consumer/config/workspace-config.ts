import fs from 'fs-extra';
import R from 'ramda';
import AbstractConfig from './abstract-config';
import { Extensions, Compilers, Testers } from './abstract-config';
import { BitConfigNotFound, InvalidBitJson, InvalidPackageJson } from './exceptions';
import {
  DEFAULT_COMPONENTS_DIR_PATH,
  DEFAULT_DEPENDENCIES_DIR_PATH,
  DEFAULT_EJECTED_ENVS_DIR_PATH,
  DEFAULT_PACKAGE_MANAGER
} from '../../constants';
import filterObject from '../../utils/filter-object';
import { ResolveModulesConfig } from '../component/dependencies/dependency-resolver/types/dependency-tree-type';
import { PathOsBasedAbsolute } from '../../utils/path';
import logger from '../../logger/logger';
import { isValidPath } from '../../utils';
import InvalidConfigPropPath from './exceptions/invalid-config-prop-path';
import ConsumerOverrides from './consumer-overrides';
import InvalidPackageManager from './exceptions/invalid-package-manager';

const DEFAULT_USE_WORKSPACES = false;
const DEFAULT_MANAGE_WORKSPACES = true;
const DEFAULT_SAVE_DEPENDENCIES_AS_COMPONENTS = false;

export type WorkspaceConfigProps = {
  compiler?: string | Compilers;
  tester?: string | Testers;
  saveDependenciesAsComponents?: boolean;
  lang?: string;
  distTarget?: string | null | undefined;
  distEntry?: string | null | undefined;
  componentsDefaultDirectory?: string;
  dependenciesDirectory?: string;
  ejectedEnvsDirectory?: string;
  bindingPrefix?: string;
  extensions?: Extensions;
  packageManager?: 'npm' | 'yarn';
  packageManagerArgs?: string[];
  packageManagerProcessOptions?: Record<string, any>;
  useWorkspaces?: boolean;
  manageWorkspaces?: boolean;
  resolveModules?: ResolveModulesConfig;
  defaultScope?: string;
  overrides?: ConsumerOverrides;
};

export default class WorkspaceConfig extends AbstractConfig {
  distTarget: string | null | undefined; // path where to store build artifacts
  // path to remove while storing build artifacts. If, for example the code is in 'src' directory, and the component
  // is-string is in src/components/is-string, the dists files will be in dists/component/is-string (without the 'src')
  distEntry: string | null | undefined;
  componentsDefaultDirectory: string;
  dependenciesDirectory: string;
  ejectedEnvsDirectory: string;
  saveDependenciesAsComponents: boolean; // save hub dependencies as bit components rather than npm packages
  packageManager: 'npm' | 'yarn'; // package manager client to use
  packageManagerArgs: string[] | null | undefined; // package manager client to use
  packageManagerProcessOptions: Record<string, any> | null | undefined; // package manager process options
  useWorkspaces: boolean; // Enables integration with Yarn Workspaces
  manageWorkspaces: boolean; // manage workspaces with yarn
  resolveModules: ResolveModulesConfig | null | undefined;
  overrides: ConsumerOverrides;
  packageJsonObject: Record<string, any> | null | undefined; // workspace package.json if exists (parsed)
  defaultScope: string | null | undefined; // default remote scope to export to

  constructor({
    compiler,
    tester,
    saveDependenciesAsComponents = DEFAULT_SAVE_DEPENDENCIES_AS_COMPONENTS,
    lang,
    distTarget,
    distEntry,
    componentsDefaultDirectory = DEFAULT_COMPONENTS_DIR_PATH,
    dependenciesDirectory = DEFAULT_DEPENDENCIES_DIR_PATH,
    ejectedEnvsDirectory = DEFAULT_EJECTED_ENVS_DIR_PATH,
    bindingPrefix,
    extensions,
    packageManager = DEFAULT_PACKAGE_MANAGER,
    packageManagerArgs,
    packageManagerProcessOptions,
    useWorkspaces = DEFAULT_USE_WORKSPACES,
    manageWorkspaces = DEFAULT_MANAGE_WORKSPACES,
    resolveModules,
    defaultScope,
    overrides = ConsumerOverrides.load()
  }: WorkspaceConfigProps) {
    super({ compiler, tester, lang, bindingPrefix, extensions });
    if (packageManager !== 'npm' && packageManager !== 'yarn') {
      throw new InvalidPackageManager(packageManager);
    }
    this.distTarget = distTarget;
    this.distEntry = distEntry;

    this.componentsDefaultDirectory = componentsDefaultDirectory;
    // Make sure we have the component name in the path. otherwise components will be imported to the same dir.
    if (!componentsDefaultDirectory.includes('{name}')) {
      this.componentsDefaultDirectory = `${this.componentsDefaultDirectory}/{name}`;
    }
    this.dependenciesDirectory = dependenciesDirectory;
    this.ejectedEnvsDirectory = ejectedEnvsDirectory;
    this.saveDependenciesAsComponents = saveDependenciesAsComponents;
    this.packageManager = packageManager;
    this.packageManagerArgs = packageManagerArgs;
    this.packageManagerProcessOptions = packageManagerProcessOptions;
    this.useWorkspaces = useWorkspaces;
    this.manageWorkspaces = manageWorkspaces;
    this.resolveModules = resolveModules;
    this.defaultScope = defaultScope;
    this.overrides = overrides;
  }

  toPlainObject() {
    const superObject = super.toPlainObject();
    let consumerObject = R.merge(superObject, {
      componentsDefaultDirectory: this.componentsDefaultDirectory,
      dependenciesDirectory: this.dependenciesDirectory,
      ejectedEnvsDirectory: this.ejectedEnvsDirectory,
      saveDependenciesAsComponents: this.saveDependenciesAsComponents,
      packageManager: this.packageManager,
      packageManagerArgs: this.packageManagerArgs,
      packageManagerProcessOptions: this.packageManagerProcessOptions,
      useWorkspaces: this.useWorkspaces,
      manageWorkspaces: this.manageWorkspaces,
      resolveModules: this.resolveModules,
      defaultScope: this.defaultScope,
      overrides: this.overrides.overrides
    });
    if (this.distEntry || this.distTarget) {
      const dist = {};
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      if (this.distEntry) dist.entry = this.distEntry;
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      if (this.distTarget) dist.target = this.distTarget;
      consumerObject = R.merge(consumerObject, { dist });
    }

    const isPropDefault = (val, key) => {
      if (key === 'dependenciesDirectory') return val !== DEFAULT_DEPENDENCIES_DIR_PATH;
      if (key === 'ejectedEnvsDirectory') return val !== DEFAULT_EJECTED_ENVS_DIR_PATH;
      if (key === 'useWorkspaces') return val !== DEFAULT_USE_WORKSPACES;
      if (key === 'manageWorkspaces') return val !== DEFAULT_MANAGE_WORKSPACES;
      if (key === 'saveDependenciesAsComponents') return val !== DEFAULT_SAVE_DEPENDENCIES_AS_COMPONENTS;
      if (key === 'resolveModules') return !R.isEmpty(val);
      if (key === 'defaultScope') return Boolean(val);
      if (key === 'overrides') return !R.isEmpty(val);
      return true;
    };

    return filterObject(consumerObject, isPropDefault);
  }

  static create(workspaceConfigProps: WorkspaceConfigProps): WorkspaceConfig {
    return new WorkspaceConfig(workspaceConfigProps);
  }

  static async ensure(
    dirPath: PathOsBasedAbsolute,
    standAlone: boolean,
    workspaceConfigProps: WorkspaceConfigProps = {}
  ): Promise<WorkspaceConfig> {
    try {
      const workspaceConfig = await this.load(dirPath);
      return workspaceConfig;
    } catch (err) {
      if (err instanceof BitConfigNotFound || err instanceof InvalidBitJson) {
        const consumerBitJson = this.create(workspaceConfigProps);
        const packageJsonExists = await AbstractConfig.pathHasPackageJson(dirPath);
        if (packageJsonExists && !standAlone) {
          consumerBitJson.writeToPackageJson = true;
        } else {
          consumerBitJson.writeToBitJson = true;
        }
        return consumerBitJson;
      }
      throw err;
    }
  }

  static async reset(dirPath: PathOsBasedAbsolute, resetHard: boolean): Promise<void> {
    const deleteBitJsonFile = async () => {
      const bitJsonPath = AbstractConfig.composeBitJsonPath(dirPath);
      logger.info(`deleting the consumer bit.json file at ${bitJsonPath}`);
      await fs.remove(bitJsonPath);
    };
    if (resetHard) await deleteBitJsonFile();
  }

  static fromPlainObject(object: Record<string, any>) {
    WorkspaceConfig.validate(object);
    const {
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      env,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      lang,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      componentsDefaultDirectory,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      dependenciesDirectory,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      ejectedEnvsDirectory,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      dist,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      bindingPrefix,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      extensions,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      saveDependenciesAsComponents,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      packageManager,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      packageManagerArgs,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      packageManagerProcessOptions,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      useWorkspaces,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      manageWorkspaces,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      resolveModules,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      defaultScope,
      // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
      overrides
    } = object;

    return new WorkspaceConfig({
      compiler: R.propOr(undefined, 'compiler', env),
      tester: R.propOr(undefined, 'tester', env),
      lang,
      bindingPrefix,
      extensions,
      saveDependenciesAsComponents,
      componentsDefaultDirectory,
      dependenciesDirectory,
      ejectedEnvsDirectory,
      packageManager,
      packageManagerArgs,
      packageManagerProcessOptions,
      useWorkspaces,
      manageWorkspaces,
      resolveModules,
      distTarget: R.propOr(undefined, 'target', dist),
      distEntry: R.propOr(undefined, 'entry', dist),
      defaultScope,
      overrides: ConsumerOverrides.load(overrides)
    });
  }

  static async load(dirPath: string): Promise<WorkspaceConfig> {
    const bitJsonPath = AbstractConfig.composeBitJsonPath(dirPath);
    const packageJsonPath = AbstractConfig.composePackageJsonPath(dirPath);

    const [bitJsonFile, packageJsonFile] = await Promise.all([
      this.loadBitJson(bitJsonPath), // $FlowFixMe
      this.loadPackageJson(packageJsonPath)
    ]);
    const bitJsonConfig = bitJsonFile || {};
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    const packageJsonHasConfig = packageJsonFile && packageJsonFile.bit;
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    const packageJsonConfig = packageJsonHasConfig ? packageJsonFile.bit : {};
    if (R.isEmpty(bitJsonConfig) && R.isEmpty(packageJsonConfig)) throw new BitConfigNotFound();
    // in case of conflicts, bit.json wins package.json
    const config = Object.assign(packageJsonConfig, bitJsonConfig);
    const workspaceConfig = this.fromPlainObject(config);
    workspaceConfig.path = bitJsonPath;
    workspaceConfig.writeToBitJson = Boolean(bitJsonFile);
    workspaceConfig.writeToPackageJson = packageJsonHasConfig;
    workspaceConfig.packageJsonObject = packageJsonFile;
    return workspaceConfig;
  }
  static async loadBitJson(bitJsonPath: string): Promise<Record<string, any> | null | undefined> {
    try {
      const file = await AbstractConfig.loadJsonFileIfExist(bitJsonPath);
      return file;
    } catch (e) {
      throw new InvalidBitJson(bitJsonPath);
    }
  }
  static async loadPackageJson(packageJsonPath: string): Promise<Record<string, any> | null | undefined> {
    try {
      const file = await AbstractConfig.loadJsonFileIfExist(packageJsonPath);
      return file;
    } catch (e) {
      throw new InvalidPackageJson(packageJsonPath);
    }
  }

  static validate(object: Record<string, any>) {
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    const { componentsDefaultDirectory, dependenciesDirectory, ejectedEnvsDirectory } = object;
    const pathsToValidate = { componentsDefaultDirectory, dependenciesDirectory, ejectedEnvsDirectory };
    Object.keys(pathsToValidate).forEach(field => throwForInvalidPath(field, pathsToValidate[field]));
    function throwForInvalidPath(fieldName, pathToValidate): void {
      if (pathToValidate && !isValidPath(pathToValidate)) {
        throw new InvalidConfigPropPath(fieldName, pathToValidate);
      }
    }
    // @ts-ignore AUTO-ADDED-AFTER-MIGRATION-PLEASE-FIX!
    ConsumerOverrides.validate(object.overrides);
  }
}
