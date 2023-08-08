import { getGqlNames } from '@keystone-6/core/types';

import {
  assertObjectType,
  GraphQLSchema,
  assertInputObjectType,
  GraphQLString,
  GraphQLID,
  parse,
  validate,
} from 'graphql';
import type { BaseItem } from '@keystone-6/core/types';
import { graphql } from '@keystone-6/core';

import type { AuthGqlNames, SecretFieldImpl } from './types';
import { validateSecret } from './lib/validateSecret';

function assertSecretFieldImpl(
  impl: any,
  listKey: string,
  secretField: string
): asserts impl is SecretFieldImpl {
  if (
    !impl ||
    typeof impl.compare !== 'function' ||
    impl.compare.length < 2 ||
    typeof impl.generateHash !== 'function'
  ) {
    const s = JSON.stringify(secretField);
    let msg = `A createAuth() invocation for the "${listKey}" list specifies ${s} as its secretField, but the field type doesn't implement the required functionality.`;
    throw new Error(msg);
  }
}

export function getSecretFieldImpl(schema: GraphQLSchema, listKey: string, fieldKey: string) {
  const gqlOutputType = assertObjectType(schema.getType(listKey));
  const secretFieldImpl = gqlOutputType.getFields()?.[fieldKey].extensions?.keystoneSecretField;
  assertSecretFieldImpl(secretFieldImpl, listKey, fieldKey);
  return secretFieldImpl;
}

export function getBaseAuthSchema<I extends string, S extends string>({
  listKey,
  identityField,
  secretField,
  gqlNames,
  secretFieldImpl,
  base,
}: {
  listKey: string;
  identityField: I;
  secretField: S;
  gqlNames: AuthGqlNames;
  secretFieldImpl: SecretFieldImpl;
  base: graphql.BaseSchemaMeta;

  // TODO: return type required by pnpm :(
}): {
  extension: graphql.Extension;
  ItemAuthenticationWithPasswordSuccess: graphql.ObjectType<{
    sessionToken: string;
    item: BaseItem;
  }>;
} {
  const ItemAuthenticationWithPasswordSuccess = graphql.object<{
    sessionToken: string;
    item: BaseItem;
  }>()({
    name: gqlNames.ItemAuthenticationWithPasswordSuccess,
    fields: {
      sessionToken: graphql.field({ type: graphql.nonNull(graphql.String) }),
      item: graphql.field({ type: graphql.nonNull(base.object(listKey)) }),
    },
  });
  const ItemAuthenticationWithPasswordFailure = graphql.object<{ message: string }>()({
    name: gqlNames.ItemAuthenticationWithPasswordFailure,
    fields: {
      message: graphql.field({ type: graphql.nonNull(graphql.String) }),
    },
  });
  const AuthenticationResult = graphql.union({
    name: gqlNames.ItemAuthenticationWithPasswordResult,
    types: [ItemAuthenticationWithPasswordSuccess, ItemAuthenticationWithPasswordFailure],
    resolveType(val) {
      if ('sessionToken' in val) {
        return gqlNames.ItemAuthenticationWithPasswordSuccess;
      }
      return gqlNames.ItemAuthenticationWithPasswordFailure;
    },
  });

  const extension = {
    query: {
      authenticatedItem: graphql.field({
        type: graphql.union({
          name: 'AuthenticatedItem',
          types: [base.object(listKey) as graphql.ObjectType<BaseItem>],
          resolveType: (root, context) => context.session?.listKey,
        }),
        resolve(root, args, context) {
          const { session } = context;
          if (!session) return null;
          if (!session.itemId) return null;
          if (session.listKey !== listKey) return null;

          return context.db[listKey].findOne({
            where: {
              id: session.itemId,
            },
          });
        },
      }),
    },
    mutation: {
      [gqlNames.authenticateItemWithPassword]: graphql.field({
        type: AuthenticationResult,
        args: {
          [identityField]: graphql.arg({ type: graphql.nonNull(graphql.String) }),
          [secretField]: graphql.arg({ type: graphql.nonNull(graphql.String) }),
        },
        async resolve(root, { [identityField]: identity, [secretField]: secret }, context) {
          if (!context.sessionStrategy) {
            throw new Error('No session implementation available on context');
          }

          const dbItemAPI = context.sudo().db[listKey];
          const item = await validateSecret(
            secretFieldImpl,
            identityField,
            identity,
            secretField,
            secret,
            dbItemAPI
          );

          if (item === null) return { code: 'FAILURE', message: 'Authentication failed.' };

          // update system state
          const sessionToken = await context.sessionStrategy.start({
            data: {
              listKey,
              itemId: item.id,
            },
            context,
          });

          // return Failure if sessionStrategy.start() returns null
          if (typeof sessionToken !== 'string' || sessionToken.length === 0) {
            return { code: 'FAILURE', message: 'Failed to start session.' };
          }

          return { sessionToken, item };
        },
      }),
    },
  };
  return { extension, ItemAuthenticationWithPasswordSuccess };
}

export const getSchemaExtension = ({
  identityField,
  listKey,
  secretField,
  gqlNames,
  sessionData,
}: {
  identityField: string;
  listKey: string;
  secretField: string;
  gqlNames: AuthGqlNames;
  sessionData: string;
}) =>
  graphql.extend(base => {
    const uniqueWhereInputType = assertInputObjectType(
      base.schema.getType(`${listKey}WhereUniqueInput`)
    );
    const identityFieldOnUniqueWhere = uniqueWhereInputType.getFields()[identityField];
    if (
      base.schema.extensions.sudo &&
      identityFieldOnUniqueWhere?.type !== GraphQLString &&
      identityFieldOnUniqueWhere?.type !== GraphQLID
    ) {
      throw new Error(
        `createAuth was called with an identityField of ${identityField} on the list ${listKey} ` +
          `but that field doesn't allow being searched uniquely with a String or ID. ` +
          `You should likely add \`isIndexed: 'unique'\` ` +
          `to the field at ${listKey}.${identityField}`
      );
    }

    const baseSchema = getBaseAuthSchema({
      identityField,
      listKey,
      secretField,
      gqlNames,
      secretFieldImpl: getSecretFieldImpl(base.schema, listKey, secretField),
      base,
    });

    // technically this will incorrectly error if someone has a schema extension that adds a field to the list output type
    // and then wants to fetch that field with `sessionData` but it's extremely unlikely someone will do that since if
    // they want to add a GraphQL field, they'll probably use a virtual field
    const query = `query($id: ID!) { ${
      getGqlNames({ listKey, pluralGraphQLName: '' }).itemQueryName
    }(where: { id: $id }) { ${sessionData} } }`;

    let ast;
    try {
      ast = parse(query);
    } catch (err) {
      throw new Error(
        `The query to get session data has a syntax error, the sessionData option in your createAuth usage is likely incorrect\n${err}`
      );
    }

    const errors = validate(base.schema, ast);
    if (errors.length) {
      throw new Error(
        `The query to get session data has validation errors, the sessionData option in your createAuth usage is likely incorrect\n${errors.join(
          '\n'
        )}`
      );
    }

    return [baseSchema.extension];
  });
