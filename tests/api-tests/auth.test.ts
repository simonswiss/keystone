import { text, password } from '@keystone-6/core/fields';
import { list } from '@keystone-6/core';
import { statelessSessions } from '@keystone-6/core/session';
import { createAuth } from '@keystone-6/auth';
import { setupTestRunner } from '@keystone-6/api-tests/test-runner';
import { allowAll } from '@keystone-6/core/access';
import { testConfig, seed } from './utils';
import { GraphQLRequest, withServer } from './with-server';

const initialData = {
  User: [
    { name: 'Boris Bozic', email: 'boris@keystonejs.com', password: 'correctbattery' },
    { name: 'Jed Watson', email: 'jed@keystonejs.com', password: 'horsestaple' },
    { name: 'Bad User', email: 'bad@keystonejs.com', password: 'incorrectbattery' },
  ],
};

const COOKIE_SECRET = 'qwertyuiopasdfghjlkzxcvbmnm1234567890';

const auth = createAuth({
  listKey: 'User',
  identityField: 'email',
  secretField: 'password',
  sessionData: 'id name',
});

const runner = withServer(
  setupTestRunner({
    config: auth.withAuth(
      testConfig({
        lists: {
          User: list({
            access: allowAll,
            fields: {
              name: text(),
              email: text({ validation: { isRequired: true }, isIndexed: 'unique' }),
              password: password(),
            },
          }),
        },
        session: statelessSessions({ secret: COOKIE_SECRET }),
      })
    ),
  })
);

async function authenticateWithPassword(
  graphQLRequest: GraphQLRequest,
  email: string,
  password: string
) {
  return graphQLRequest({
    query: `
      mutation($email: String!, $password: String!) {
        authenticateUserWithPassword(email: $email, password: $password) {
          ... on UserAuthenticationWithPasswordSuccess {
            sessionToken
            item { id }
          }
          ... on UserAuthenticationWithPasswordFailure {
            message
          }
        }
      }
    `,
    variables: { email, password },
  });
}

describe('Auth testing', () => {
  describe('authenticateItemWithPassword', () => {
    test(
      'Success - set token in header and return value',
      runner(async ({ context, graphQLRequest }) => {
        const { User: users } = await seed(context, initialData);
        const { body, res } = (await authenticateWithPassword(
          graphQLRequest,
          'boris@keystonejs.com',
          'correctbattery'
        )) as any;

        const sessionHeader = res.rawHeaders
          .find((h: string) => h.startsWith('keystonejs-session'))
          .split(';')[0]
          .split('=')[1];
        expect(body.errors).toBe(undefined);
        expect(body.data).toEqual({
          authenticateUserWithPassword: {
            sessionToken: sessionHeader,
            item: { id: users[0].id },
          },
        });
      })
    );

    test(
      'Failure - bad password',
      runner(async ({ context, graphQLRequest }) => {
        await seed(context, initialData);

        const { body, res } = (await authenticateWithPassword(
          graphQLRequest,
          'boris@keystonejs.com',
          'incorrectbattery'
        )) as any;

        const sessionHeader = res.rawHeaders.find((h: string) =>
          h.startsWith('keystonejs-session')
        );
        expect(sessionHeader).toBe(undefined);
        expect(body.errors).toBe(undefined);
        expect(body.data).toEqual({
          authenticateUserWithPassword: { message: 'Authentication failed.' },
        });
      })
    );

    test(
      'Failure - bad identify value',
      runner(async ({ context, graphQLRequest }) => {
        await seed(context, initialData);

        const { body, res } = (await authenticateWithPassword(
          graphQLRequest,
          'bort@keystonejs.com',
          'correctbattery'
        )) as any;

        const sessionHeader = res.rawHeaders.find((h: string) =>
          h.startsWith('keystonejs-session')
        );
        expect(sessionHeader).toBe(undefined);
        expect(body.errors).toBe(undefined);
        expect(body.data).toEqual({
          authenticateUserWithPassword: { message: 'Authentication failed.' },
        });
      })
    );
  });
});
