import { config } from '@keystone-6/core';
import { statelessSessions } from '@keystone-6/core/session';
import { createAuth } from '@keystone-6/auth';
import { fixPrismaPath } from '../example-utils';
import { lists } from './schema';

// WARNING: this example is for demonstration purposes only
//   as with each of our examples, it has not been vetted
//   or tested for any particular usage
// withAuth is a function we can use to wrap our base configuration

const authSessionStrategy = statelessSession({
  // the maxAge option controls how long session cookies are valid for before they expire
  maxAge: 60 * 60 * 24 * 30,
  // the session secret is used to encrypt cookie data
  // WARNING: you need to change this
  secret: '-- DEV COOKIE SECRET; CHANGE ME --',
});

//    start: ({ context, inputData }) => {
//      const user = await context.extensions.User.password.findAndValidate({
//        where: { name: inputData.identifier, },
//        password: inputData.password,
//      })
//      if (!user) return
//      return sessionStrategy.start({ context, data: { id: user.id } })
//    },
//    get: ({ context } => {
//      const session = sessionStrategy.get({ context });
//      const user = await context.db.User.findOne({
//        where: { id: session.itemId }
//      });
//      if (!user) return;
//      return { id: user.id, isAdmin: user.isAdmin };
//    }
const withAuth = createAuth({
  listKey: 'User',
  identifyBy: 'name',
  compareBy: 'password'
  strategy: authSessionStrategy
});

const withAuth = createAuth({
  validate: {
    listKey: 'User',
    identifier: 'name',
    password: 'password',
  }
  strategy: authSessionStrategy
});

const withAuth = createAuth({
  fields: {
    organisation: text(),
    name: text(),
    password: password(),
    mfa: text()
  },
  validate: ({ context, inputData }) => {
    const user = context.db.User.findOne({ name: inputData.name, active: true })
    /// ....
  }),
  strategy: authSessionStrategy
});

export default withAuth(
  config({
    db: {
      provider: 'sqlite',
      url: process.env.DATABASE_URL || 'file:./keystone-example.db',

      // WARNING: this is only needed for our monorepo examples, dont do this
      ...fixPrismaPath,
    },
    lists,
    ui: {
      // only admins can view the AdminUI
      isAccessAllowed: ({ session }) => {
        return session?.data?.isAdmin ?? false;
      },
    },

    // WARNING: this would come with withAuth by default
    getSession: ({ context }) => {
      const session = authSessionStrategy.get({ context });
      const user = await context.db.User.findOne({
        where: { id: session.id }
      });
      if (!user) return;

      return { id: user.id, isAdmin: user.isAdmin };
    }
  })
);
