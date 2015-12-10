import Debug from 'debug';
import {Database, aqlQuery} from 'arangojs';
import Proxy from 'harmony-proxy';
import Reflect from 'harmony-reflect';


let debug = Debug('koa-session-arango');


/**
 * Initialize session middleware with `opts`:
 *
 * - `key` session cookie name ["koa:sess"]
 * - all other options are passed as cookie options
 *
 * @param {Object} [opts]
 * @api public
 */


let defaultOptions = {
  url: 'http://localhost:8529',
  database: 'test',
  collection: 'sessions',
  properties: {
    waitForSync: true
  },
  ttl: 60 * 60 * 24 * 14 // 14 days
};


export default function storage ({store, key='koa:sess', ...cookies}=opts) {
  debug('key config is: %s', key);

  store = Object.assign({}, defaultOptions, store);
  debug('arango url: %s', store.url);
  debug('arango database: %s', store.database);
  debug('arango collection: %s', store.collection);
  debug('arango collection properties: %s', store.properties);

  //cookies opts
  let cookieOption = cookies || {};
  debug('cookie config all: %j', cookieOption);
  debug('cookie config overwrite: %s',
        (cookieOption.overwrite === false) ?
          false : (cookieOption.overwrite = true));

  debug('cookie config httpOnly: %s',
        (cookieOption.httpOnly === false) ?
          false : (cookieOption.httpOnly = true));

  debug('cookie config signed: %s',
        (cookieOption.signed === false) ?
          false : (cookieOption.signed = true));

  debug('cookie config maxage: %s',
        (typeof cookieOption.maxage !== 'undefined') ? cookieOption.maxage :
          (cookieOption.maxage = store.ttl * 1000 || null));

  // Create and update properties of collections.
  let db = new Database({
    url: store.url,
    databaseName: store.database
  });

  let collection = db.collection(store.collection);

  // Do async code here!
  (async () => {
    try {
      await db.get();
    } catch (e) {
      console.error(`Database '${ store.database }' doesn't exists.`);
      throw e;
    }

    try {
      await collection.setProperties(store.properties);
    } catch (e) {
      await collection.create(store.properties);
    }
  }) ();

  return async function (next) {
    let sess, sid, json, data;

    // to pass to Session()
    this.cookieOption = cookieOption;
    this.sessionKey = key;
    this.sessionId = null;

    sid = this.cookies.get(key, cookieOption);

    if (sid) {
      debug('sid %s', sid);

      let cursor = await db.query(
        aqlQuery`
        FOR session IN ${collection}
        FILTER session._key == ${sid} && session.expireAt > ${new Date()}
        RETURN session
        `
      );

      data = await cursor.next();

      if (data) {
        json = data.data;
      }
    }

    if (json) {
      this.sessionId = sid;
      debug('parsing %s', json);
      sess = new Session(this, JSON.parse(json));
      sess = new Proxy(sess, proxy);
    } else {
      data = await collection.save({
        data: '{}',  // This will handle empty object.
        createdAt: new Date(),
        expireAt: new Date(Date.now() + store.ttl * 1000)
      });

      this.sessionId = data._key;

      debug('new session');
      sess = new Session(this);
      sess = new Proxy(sess, proxy);
    }

    this.__defineGetter__('session', function () {
      // already retrieved
      if (sess) return sess;
      // unset
      if (false === sess) return null;
    });

    this.__defineSetter__('session', function (val) {
      if (null === val) return sess = false;
      if ('object' === typeof val) return sess = new Session(this, val);
      throw new Error('this.session can only be set as null or an object.');
    });

    try {
      await next;
    } catch (err) {
      throw err;
    } finally {
      if (false === sess) {
        // remove
        this.cookies.set(key, '', cookieOption);
        collection.remove(sid);
      } else if (sess.isModified || sess.isNew) {
        // save
        json = sess.save();
        collection.update(data, {data: json});
      }
    }
  };
}



/**
 * Proxy used to mark as modified the session if need
 * also lastModified.
 *
 */
let proxy = {

  set: function (obj, prop, value) {
    obj.isModified = true;
    obj[prop] = value;
  },

  ownKeys: function(target) {
    return Reflect.ownKeys(target);
  }
};


/**
 * Session model.
 *
 * @param {Context} ctx
 * @param {Object} obj
 * @api private
 */

class Session {

  constructor (context, object) {

    this._ctx = Object.assign({}, context);
    this.isModified = false;

    if (object) {
      Object.assign(this, object);
    } else {
      this.isNew = true;
    }
  }

  /**
   * JSON representation of the session.
   *
   * @return {Object}
   * @api public
   */

  inspect () {
    let self = this;
    let obj = {};

    Reflect.ownKeys(this).forEach(function (key) {
      if ('isNew' === key) return;
      if ('_' === key[0]) return;
      if ('_' === key[0]) return;
      obj[key] = self[key];
    });

    return obj;
  }

  /**
   * JSON representation of the session.
   *
   * @return {Object}
   * @api public
   */

  toJSON () {
    let self = this;
    let obj = {};

    Reflect.ownKeys(this).forEach(function (key) {
      if ('isNew' === key) return;
      if ('isModified' === key) return;
      if ('_' === key[0]) return;
      obj[key] = self[key];
    });

    return obj;
  }

  /**
   * Save session changes by
   * performing a Set-Cookie.
   *
   * @api private
   */
  save () {
    let ctx = this._ctx;
    let json = this._json || JSON.stringify(this);
    let sid = ctx.sessionId;
    let opts = ctx.cookieOption;
    let key = ctx.sessionKey;

    debug('save %s', json);
    ctx.cookies.set(key, sid, opts);
    return json;
  }
}


