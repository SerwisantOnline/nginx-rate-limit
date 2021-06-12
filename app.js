const YAML = require('js-yaml');
const Fs = require('fs');
const Redis = require("ioredis");
const Http = require('http');
const Cookie = require('cookie');
const _ = require('lodash');

const config = YAML.load(Fs.readFileSync(__dirname + '/config.yml', 'utf8'));
const redis = new Redis(_.get(config, 'redis'));

function byPass(path, ip, cookies) {
    let bypass_ips = _.get(config, 'bypass.ip', []);
    if (_.indexOf(bypass_ips, ip) !== -1) {
        return true;
    }

    let
        bypass_paths = _.get(config, 'bypass.path', []),
        path_fo_find = _.replace(path, '//', '/');
    if (_.size(_.filter(bypass_paths, function (p) {
        return _.startsWith(path_fo_find, p);
    })) > 0) {
        return true;
    }

    let bypass_cookies_names = _.get(config, 'bypass.cookie', []);
    if (_.size(_.filter(bypass_cookies_names, function (cn) {
        return _.has(cookies, cn)
    })) > 0) {
        return true;
    }

    return false;
}

function detectKey(path, ip, cookies) {
    let
        key = null,
        cookie_names = _.get(config, 'cookie_names', []);
    _.forEach(cookie_names, function (cookie_name) {
        if (_.isNull(key) && _.has(cookies, cookie_name)) {
            key = cookie_name + '=' + cookies[cookie_name]
        }
    });
    if (_.isNull(key)) {
        key = ip
    }
    return key.slice(0, 64);
}

function checkLimit(key, onSuccess, onLimit) {
    let
        current_time = Math.floor(new Date().getTime() / 1000),
        current_second = (current_time % 60),
        current_minute = (Math.floor(current_time / 60) % 60),
        past_minute = ((current_minute + 59) % 60);

    let
        key_prefix = "nginx_rate_limit(" + key + ")",
        current_key = key_prefix + current_minute,
        past_key = key_prefix + past_minute;

    let pipeline = redis.pipeline();
    pipeline.get(past_key);
    pipeline.incr(current_key);
    pipeline.expire(current_key, (2 * 60 - current_second));

    pipeline.exec((err, results) => {
        let first_resp = results[0][1]
        if (_.isNull(first_resp)) {
            first_resp = "0"
        }
        let
            past_counter = _.parseInt(first_resp),
            current_counter = (_.parseInt(results[1][1]) - 1),
            current_rate = (past_counter * ((60 - (current_time % 60)) / 60) + current_counter).toFixed(2);

        if (current_rate > _.parseInt(_.get(config, 'threshold', 20))) {
            onLimit(current_rate);
        } else {
            onSuccess(current_rate);
        }
    });
}

function finish(res, code, message) {
    res.writeHead(code, {'Content-Type': 'text/plain'});
    res.end(message + "\n");
}

const server = Http.createServer(function (req, res) {
    const
        request_path = _.get(req.headers, 'x-original-uri', '/'),
        request_ip = _.get(req.headers, 'x-original-ip', '0.0.0.0'),
        cookies = Cookie.parse(_.get(req.headers, 'cookie', ''));
    if (byPass(request_path, request_ip, cookies)) {
        finish(res, 200, 'BYPASS');
        return;
    }
    let limit_key = detectKey(request_path, request_ip, cookies);
    checkLimit(limit_key,
        function (current_rate) {
            finish(res, 200, 'PASS (' + limit_key + ') ' + current_rate);
        }, function (current_rate) {
            console.log((new Date()).toISOString() + ": BLOCK (" + limit_key + ') ' + request_ip + ' ' + request_path + " (" + current_rate + ")");
            let http_code = 401;
            if (_.get(config, 'testing', false) === true) {
                http_code = 200;
            }
            finish(res, http_code, 'BLOCK (' + limit_key + ') ' + current_rate);
        });
});

server.listen(_.get(config, 'port', 3001));
