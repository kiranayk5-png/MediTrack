const supertest = require('supertest');
const config = require('../../src/config');

// API workflow tests model the browser's trusted frontend origin by default.
// Individual tests can override Origin to exercise rejection behavior.
module.exports = (app) => {
  const agent = supertest(app);
  return new Proxy(agent, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver);
      if (['post', 'put', 'patch', 'delete'].includes(property)) {
        return (...args) => member.apply(target, args).set('Origin', config.frontendOrigin);
      }
      return typeof member === 'function' ? member.bind(target) : member;
    },
  });
};
