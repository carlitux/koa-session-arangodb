import Debug from 'debug';
import {Database, aqlQuery} from 'arangojs';
import Proxy from 'harmony-proxy';
import Reflect from 'harmony-reflect';
import { EventEmitter } from 'events';

import MemoryStore from 'koa-generic-session/lib/memory_store';


let debug = Debug('koa-session-arango');


export default class ArangoStore extends EventEmitter {

  /**
   * Initialize arangodb session middleware with `opts`:
   *
   * If not url, databaseName is not set fallback to MemoryStore
   *
   * @param {Object} options
   *   - {String} url           arandodb connect url.
   *   - {String} databaseName      arandodb connect database name.
   *   - {String} collectionName    arandodb connect collection.
   *   - {Object} properties    arangodb collection properties.
   */

  constructor (
    {url, databaseName, collectionName='sessions', properties={}}=options) {

    super();

    debug('arango url: %s', url);
    debug('arango database: %s', databaseName);
    debug('arango collection: %s', collectionName);
    debug('arango collection properties: %s', properties);

    if (!(url && databaseName)) {
      debug('Required params not set, now using Memory Storage');
      return new MemoryStore();
    }

    // force to wait for Sync
    properties.waitForSync = true;

    // Create and update properties of collections.
    this.db = new Database({ url, databaseName });
    this.collection = this.db.collection(collectionName);

    // Do async code here!
    (async () => {
      try {
        await this.db.get();
      } catch (e) {
        console.error(`Database '${ databaseName }' doesn't exists.`);
        this.emit('disconnect');
        throw e;
      }

      try {
        await this.collection.setProperties(properties);
      } catch (e) {
        await this.collection.create(properties);
      }

      await this.collection.createHashIndex(['expireAt', 'sid']);
      this.emit('connect');
    }) ();
  }

  async get (sid) {
    debug('sid %s', sid);

    let cursor = await this.db.query(
      aqlQuery`
      FOR session IN ${this.collection}
      FILTER session.sid == ${sid} &&
      (session.expireAt == null || session.expireAt > ${Date.now()})
      RETURN session
      `
    );

    this._session = await cursor.next();
    debug('get session: %s', this._session || 'none');

    try {
      return JSON.parse(this._session.data);
    } catch (err) {
      // ignore err
      debug('parse session error: %s', err.message);
    }
  }

  async set (sid, sess, ttl) {
    let data = JSON.stringify(sess);
    let session = { sid, data };

    debug('With %s %s %s', sid, ttl, sess);
    if (ttl && typeof ttl === 'number') {
      session.expireAt = new Date(Date.now() + ttl * 1000);
    }

    if (this._session) {
      debug('Updating session: %s', sid);
      await this.collection.update(this._session, {data: session.data});
    } else {
      debug('Saving session: %s', sid);
      this._session = await this.collection.save(session);
    }

    debug('SET %s complete', sid);
  }

  async destroy (sid, sess) {
    debug('DEL %s', sid);
    collection.remove(this._session);
    debug('DEL %s complete', sid);
  }
}


/**
 * Initialize session middleware with `opts`:
 *
 * - `key` session cookie name ["koa:sess"]
 * - all other options are passed as cookie options
 *
 * @param {Object} [opts]
 * @api public
 */


// let defaultOptions = {
//   url: 'http://localhost:8529',
//   database: 'test',
//   collection: 'sessions',
//   properties: {
//     waitForSync: true
//   },
//   ttl: 60 * 60 * 24 * 14 // 14 days
// };
//
//
// export default function storage ({store, key='koa:sess', ...cookies}=opts) {
//   debug('key config is: %s', key);
//
//   store = Object.assign({}, defaultOptions, store);
//   //cookies opts
//   let cookieOption = cookies || {};
//   debug('cookie config all: %j', cookieOption);
//   debug('cookie config overwrite: %s',
//         (cookieOption.overwrite === false) ?
//           false : (cookieOption.overwrite = true));
//
//   debug('cookie config httpOnly: %s',
//         (cookieOption.httpOnly === false) ?
//           false : (cookieOption.httpOnly = true));
//
//   debug('cookie config signed: %s',
//         (cookieOption.signed === false) ?
//           false : (cookieOption.signed = true));
//
//   debug('cookie config maxage: %s',
//         (typeof cookieOption.maxage !== 'undefined') ? cookieOption.maxage :
//           (cookieOption.maxage = store.ttl * 1000 || null));
//
//
//   return async function (next) {
//     let sess, sid, json, data;
//
//     // to pass to Session()
//     this.cookieOption = cookieOption;
//     this.sessionKey = key;
//     this.sessionId = null;
//
//     sid = this.cookies.get(key, cookieOption);
//
//     if (sid) {
//     }
//
//     if (json) {
//       this.sessionId = sid;
//       debug('parsing %s', json);
//       sess = new Session(this, JSON.parse(json));
//       sess = new Proxy(sess, proxy);
//     } else {
//
//       this.sessionId = data._key;
//
//       debug('new session');
//       sess = new Session(this);
//       sess = new Proxy(sess, proxy);
//     }
//
//     this.__defineGetter__('session', function () {
//       // already retrieved
//       if (sess) return sess;
//       // unset
//       if (false === sess) return null;
//     });
//
//     this.__defineSetter__('session', function (val) {
//       if (null === val) return sess = false;
//       if ('object' === typeof val) return sess = new Session(this, val);
//       throw new Error('this.session can only be set as null or an object.');
//     });
//
//     try {
//       await next;
//     } catch (err) {
//       throw err;
//     } finally {
//       if (false === sess) {
//         // remove
//         this.cookies.set(key, '', cookieOption);
//         collection.remove(sid);
//       } else if (sess.isModified || sess.isNew) {
//         // save
//         json = sess.save();
//         collection.update(data, {data: json});
//       }
//     }
//   };
// }
//
//
//
// #<{(|*
//  * Proxy used to mark as modified the session if need
//  * also lastModified.
//  *
//  |)}>#
// let proxy = {
//
//   set: function (obj, prop, value) {
//     obj.isModified = true;
//     obj[prop] = value;
//   },
//
//   ownKeys: function(target) {
//     return Reflect.ownKeys(target);
//   }
// };
//
//
// #<{(|*
//  * Session model.
//  *
//  * @param {Context} ctx
//  * @param {Object} obj
//  * @api private
//  |)}>#
//
// class Session {
//
//   constructor (context, object) {
//
//     this._ctx = Object.assign({}, context);
//     this.isModified = false;
//
//     if (object) {
//       Object.assign(this, object);
//     } else {
//       this.isNew = true;
//     }
//   }
//
//   #<{(|*
//    * JSON representation of the session.
//    *
//    * @return {Object}
//    * @api public
//    |)}>#
//
//   inspect () {
//     let self = this;
//     let obj = {};
//
//     Reflect.ownKeys(this).forEach(function (key) {
//       if ('isNew' === key) return;
//       if ('_' === key[0]) return;
//       if ('_' === key[0]) return;
//       obj[key] = self[key];
//     });
//
//     return obj;
//   }
//
//   #<{(|*
//    * JSON representation of the session.
//    *
//    * @return {Object}
//    * @api public
//    |)}>#
//
//   toJSON () {
//     let self = this;
//     let obj = {};
//
//     Reflect.ownKeys(this).forEach(function (key) {
//       if ('isNew' === key) return;
//       if ('isModified' === key) return;
//       if ('_' === key[0]) return;
//       obj[key] = self[key];
//     });
//
//     return obj;
//   }
//
//   #<{(|*
//    * Save session changes by
//    * performing a Set-Cookie.
//    *
//    * @api private
//    |)}>#
//   save () {
//     let ctx = this._ctx;
//     let json = this._json || JSON.stringify(this);
//     let sid = ctx.sessionId;
//     let opts = ctx.cookieOption;
//     let key = ctx.sessionKey;
//
//     debug('save %s', json);
//     ctx.cookies.set(key, sid, opts);
//     return json;
//   }
// }
//
//
