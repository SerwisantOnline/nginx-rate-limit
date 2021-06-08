const YAML = require('js-yaml');
const Fs = require('fs');
const Redis = require("ioredis");
const Http = require('http');
const _ = require('lodash');

const config = YAML.load(Fs.readFileSync(__dirname + '/config.yml', 'utf8'));
const redis = new Redis(_.get(config, 'redis'));

function bypass(path, method, ip) {
    if (_.indexOf(_.get(config, 'whitelist.ip', []), ip) !== -1) {
        return true;
    }
    let
        path_found = false,
        path_in_request = _.replace(path, '//', '/');
    _.forEach(_.get(config, 'whitelist.path', []), function (path_to_bypass) {
        if (_.startsWith(path_in_request, path_to_bypass)) {
            path_found = true;
        }
    })
    return path_found;
}

function checkLimit(ip, onSuccess, onLimit) {
    let
        current_time = Math.floor(new Date().getTime() / 1000),
        current_second = (current_time % 60),
        current_minute = (Math.floor(current_time / 60) % 60),
        past_minute = ((current_minute + 59) % 60);

    let
        key_prefix = "nginx_rate_limit(" + ip + ")",
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
        requestPath = _.get(req.headers, 'x-original-uri', ''),
        requestMethod = _.upperCase(_.get(req.headers, 'x-original-method', '')),
        requestIP = _.get(req.headers, 'x-original-ip', '');

    if (bypass(requestPath, requestMethod, requestIP)) {
        finish(res, 200, 'BYPASS');
        return;
    }
    checkLimit(requestIP,
        function (current_rate) {
            finish(res, 200, 'PASS: ' + current_rate);
        }, function (current_rate) {
            console.log((new Date()).toISOString() + ": BLOCK: " + requestIP + ' ' + requestPath + " (" + current_rate + ")");
            let http_code = 401;
            if (_.get(config, 'testing', false) === true) {
                http_code = 200;
            }
            finish(res, http_code, 'BLOCK: ' + current_rate);
        });
});

server.listen(_.get(config, 'port', 3001));
