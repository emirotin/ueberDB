/**
 * 2011 Peter 'Pita' Martischka
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var pg = require("pg"),
    async = require("async");

exports.database = function(settings) {
    this.settings = settings;

    var connString = "tcp://";

    if (this.settings.user) {
        connString += this.settings.user;
        if (this.settings.password) {
            connString += ":" + this.settings.password;
        }
        connString += "@";
    }

    if (this.settings.host) {
        connString += this.settings.host;
    }

    if (this.settings.port) {
        connString += ":" + this.settings.port;
    }

    if (this.settings.database) {
        connString += "/" + this.settings.database;
    }

    this.settings.cache = 1000;
    this.settings.writeInterval = 100;
    this.settings.json = true;

    this.db = new pg.Client(connString);
    this.db.connect();
};

exports.database.prototype.init = function(callback) {
    var testTableExists = "SELECT 1 as exists FROM pg_tables WHERE tablename = 'store'", createTable = 'CREATE TABLE store (' +
        '"key" character varying(100) NOT NULL, ' +
        '"value" text NOT NULL, ' +
        'CONSTRAINT store_pkey PRIMARY KEY (key))',
        createFunc = "CREATE OR REPLACE FUNCTION ueberdb_insert_or_update(character varying, text) " +
            "RETURNS void AS $$ " +
            "BEGIN " +
            "  IF EXISTS( SELECT * FROM store WHERE key = $1 ) THEN " +
            "    UPDATE store SET value = $2 WHERE key = $1; " +
            "  ELSE " +
            "    INSERT INTO store(key,value) VALUES( $1, $2 ); " +
            "  END IF; " +
            "  RETURN; " +
            "END; " +
            "$$ LANGUAGE plpgsql;",
        _this = this;

    this.db.query(createFunc, []);

    this.db.query(testTableExists, function(err, result) {
        if (!result.rows.length) {
            _this.db.query(createTable, callback);
        } else {
            callback();
        }
    });
};

exports.database.prototype.get = function(key, callback) {
    this.db.query("SELECT value FROM store WHERE key=$1", [key], function(err, results) {
        var value = null;
        if (!err && results.rows.length === 1) {
            value = results.rows[0].value;
        }
        callback(err, value);
    });
};

exports.database.prototype.set = function(key, value, callback) {
    if (key.length > 100) {
        callback("Your Key can only be 100 chars");
    }
    else {
        this.db.query("SELECT ueberdb_insert_or_update($1,$2)", [key, value], callback);
    }
};

exports.database.prototype.remove = function(key, callback) {
    this.db.query("DELETE FROM store WHERE key=$1", [key], callback);
};

exports.database.prototype.doBulk = function(bulk, callback) {
    var _this = this,
        replaceVALs = [],
        removeSQL = "DELETE FROM store WHERE key IN (",
        removeVALs = [],
        removeCount = 0,
        i, l;

    for (i = 0, l = bulk.length; i < l; i++) {
        if (bulk[i].type === "set") {
            replaceVALs.push([bulk[i].key, bulk[i].value]);
        }
        else if (bulk[i].type === "remove") {
            if (removeCount) {
                removeSQL += ",";
            }
            removeCount += 1;

            removeSQL += "$" + removeCount;
            removeVALs.push(bulk[i].key);
        }
    }

    removeSQL += ");";

    async.parallel([
        function(callback) {
            var v, l;
            if (replaceVALs.length) {
                for (v = 0, l = replaceVALs.length; v < l; v++) {
                    _this.db.query("SELECT ueberdb_insert_or_update($1,$2)", replaceVALs[v], callback);
                }
            } else {
                callback();
            }
        },
        function(callback) {
            if (removeVALs.length) {
                _this.db.query(removeSQL, removeVALs, callback);
            }
            else {
                callback();
            }
        }
    ], callback);

};

exports.database.prototype.close = function(callback) {
    var _this = this;
    this.db.on('drain', function() {
        _this.db.end.bind(_this.db);
        callback(null);
    });
};