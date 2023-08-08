import { config } from '@keystone-6/core';
import { statelessSessions } from '@keystone-6/core/session';
import { createAuth } from '@keystone-6/auth';
import { fixPrismaPath } from '../example-utils';
import { lists } from './schema';

///////// EXPERIMENT: Versatile Auth
//
//  hypothesis:
//     trying to decrease the responsibility of the auth package
//     not hinder new users
//
//     increase progressive enhancement
//     decrease the mystery of the auth package
//     remove the confusing string sessionData , but allow users to actually customise their session
//
//     ability to customize atleast the start,  and maybe the end of a session
//       its a huge jump currently
//
//  problem:
//    these apis are all super inter-linked
//    getSession has been proposed, but it has issues with dependency injection when it comes to managing the session on the client side, aka, cookies et al
//      its only good for the keystone side
//
//    we need to bridge that gap
//
//    how do we do custom logins like CAPTCHAs and or organisations, or 2FA, et cetera

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
  validateBy: {
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
