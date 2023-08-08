import type {
  BaseListTypeInfo,
  KeystoneConfig,
  KeystoneContext,
  SessionStrategy,
  BaseKeystoneTypeInfo,
} from '@keystone-6/core/types';

import type { AuthConfig, AuthGqlNames } from './types';
import { getSchemaExtension } from './schema';
import { signinTemplate } from './templates/signin';

export type AuthSession = {
  listKey: string; // TODO: use ListTypeInfo
  itemId: string | number; // TODO: use ListTypeInfo
  data: unknown; // TODO: use ListTypeInfo
};

// TODO: use TypeInfo and listKey for types
/**
 * createAuth function
 *
 * Generates config for Keystone to implement standard auth features.
 */
export function createAuth<ListTypeInfo extends BaseListTypeInfo>({
  listKey,
  secretField,
  identityField,
  sessionData = 'id',
}: AuthConfig<ListTypeInfo>) {
  const gqlNames: AuthGqlNames = {
    authenticateItemWithPassword: `authenticate${listKey}WithPassword`,
    ItemAuthenticationWithPasswordResult: `${listKey}AuthenticationWithPasswordResult`,
    ItemAuthenticationWithPasswordSuccess: `${listKey}AuthenticationWithPasswordSuccess`,
    ItemAuthenticationWithPasswordFailure: `${listKey}AuthenticationWithPasswordFailure`,
  };

  /**
   * getAdditionalFiles
   *
   * This function adds files to be generated into the Admin UI build. Must be added to the
   * ui.getAdditionalFiles config.
   *
   * The signin page is always included, and the init page is included when initFirstItem is set
   */
  function authGetAdditionalFiles () {
    return  [
      {
        mode: 'write',
        src: signinTemplate({ gqlNames, identityField, secretField }),
        outputPath: 'pages/signin.js',
      } as const,
    ];
  }

  /**
   * extendGraphqlSchema
   *
   * Must be added to the extendGraphqlSchema config. Can be composed.
   */
  const authExtendGraphqlSchema = getSchemaExtension({
    identityField,
    listKey,
    secretField,
    gqlNames,
    sessionData,
  });

  function throwIfInvalidConfig<TypeInfo extends BaseKeystoneTypeInfo>(
    config: KeystoneConfig<TypeInfo>
  ) {
    if (!(listKey in config.lists)) {
      throw new Error(`withAuth cannot find the list "${listKey}"`);
    }

    // TODO: verify that the identity field is unique
    // TODO: verify that the field is required
    const list = config.lists[listKey];
    if (!(identityField in list.fields)) {
      throw new Error(`withAuth cannot find the identity field "${listKey}.${identityField}"`);
    }

    if (!(secretField in list.fields)) {
      throw new Error(`withAuth cannot find the secret field "${listKey}.${secretField}"`);
    }
  }

  // this strategy wraps the existing session strategy,
  //   and injects the requested session.data before returning
  function authSessionStrategy<Session extends AuthSession>(
    _sessionStrategy: SessionStrategy<Session>
  ): SessionStrategy<Session> {
    const { get, ...sessionStrategy } = _sessionStrategy;
    return {
      ...sessionStrategy,
      get: async ({ context }) => {
        const session = await get({ context });
        const sudoContext = context.sudo();
        if (!session) return;
        if (!session.itemId) return;
        if (session.listKey !== listKey) return;

        try {
          const data = await sudoContext.query[listKey].findOne({
            where: { id: session.itemId },
            query: sessionData,
          });
          if (!data) return;

          return { ...session, itemId: session.itemId, listKey, data };
        } catch (e) {
          console.error(e);
          // TODO: the assumption is this could only be from an invalid sessionData configuration
          //   it could be something else though, either way, result is a bad session
          return;
        }
      },
    };
  }

  async function authMiddleware<TypeInfo extends BaseKeystoneTypeInfo>({
    context,
    wasAccessAllowed,
    basePath,
  }: {
    context: KeystoneContext<TypeInfo>;
    wasAccessAllowed: boolean;
    basePath: string;
  }): Promise<{ kind: 'redirect'; to: string } | void> {
    // don't redirect if we have access
    if (wasAccessAllowed) return;

    // otherwise, redirect to signin
    return { kind: 'redirect', to: `${basePath}/signin` };
  }

  function defaultIsAccessAllowed({ session, sessionStrategy }: KeystoneContext) {
    return session !== undefined;
  }

  function defaultExtendGraphqlSchema<T>(schema: T) {
    return schema;
  }

  /**
   * withAuth
   *
   * Automatically extends your configuration with a prescriptive implementation.
   */
  function withAuth<TypeInfo extends BaseKeystoneTypeInfo>(
    config: KeystoneConfig<TypeInfo>
  ): KeystoneConfig<TypeInfo> {
    throwIfInvalidConfig(config);
    let { ui } = config;
    if (!ui?.isDisabled) {
      const {
        getAdditionalFiles = [],
        isAccessAllowed = defaultIsAccessAllowed,
        pageMiddleware,
        publicPages = [],
      } = ui || {};
      const authPublicPages = [`${ui?.basePath ?? ''}/signin`];
      ui = {
        ...ui,
        publicPages: [...publicPages, ...authPublicPages],
        getAdditionalFiles: [...getAdditionalFiles, authGetAdditionalFiles],
        isAccessAllowed,
        pageMiddleware: async args => {
          const shouldRedirect = await authMiddleware(args);
          if (shouldRedirect) return shouldRedirect;
          return pageMiddleware?.(args);
        },
      };
    }

    if (!config.session) throw new TypeError('Missing .session configuration');

    const { extendGraphqlSchema = defaultExtendGraphqlSchema } = config;

    return {
      ...config,
      ui,
      session: authSessionStrategy(config.session),
      extendGraphqlSchema: schema => {
        return extendGraphqlSchema(authExtendGraphqlSchema(schema));
      },
    };
  }

  return {
    withAuth,
  };
}
