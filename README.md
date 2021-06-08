# nginx-rate-limit

This is middleware application for Nginx designed to perform rate limit in distributed (multi-server) setups.

Nginx has a native rate limiter functions, but it works in a scope of single Nginx instance. If you're using a HTTP load
balancer, like HAProxy and behind it are standing n+1 Nginx instances native rate limit do not works as expected because
Nginx instances do not share a traffic status.

This application has a locale instance working with each Nginx instance and is using a shared Redis database for sharing
HTTP traffic status.

## Requirements

- Nginx (1.5.4+)
- Redis (any version, ideally with Sentinel for HA purposes)
- Nodejs with npm

## Installation

Clone repository to separate directory, run `npm install` and run application `node app.js`
Make sure application will start with your OS and will be respawned when will exit.

If with your Nginx you're using a Passenger, you can configure HTTP server to run it as any other application. Example
Nginx config `/etc/nginx/sites-enabled/nginx_rate_limit`:

```editorconfig
server {
    listen 127.0.0.1:3001 default_server;
    server_name _;
    root /usr/local/lib/nginx_rate_limit/public;
    passenger_enabled on;
    passenger_app_type node;
    passenger_startup_file app.js;
}
```

In booth cases (standalone or Passenger) application will listen for incoming connections on `localhost` on port 3001.

## Configuration

### Application

Before first launch of application config file `config.yml` must be created.

See `config-example.yaml` for example config. You can copy it as a default configuration:

```shell
cp config-example.yaml config.yaml
```

At least you must configure a Redis credentials. You can provide a
single-server credentials like:

```yaml
redis:
  port: 6379
  host: "localhost"
  db: 0
```

Also Sentinel setups are supported:

```yaml
redis:
    name: mymaster
    sentinels:
      - host: 10.0.0.1
        port: 26379
      - host: 10.0.0.2
        port: 26379               
      - host: 10.0.0.3
        port: 26379
```

You can also configure rate limit threshold (req/min), and some exclusions like bypassed IPs or request paths.
Application by default is blocking requests - it's strongly recommended to set option `testing: true` on the
beginning and monitor Nginx error log (or terminal output) for blocked requests to set proper value of `threshold`.

### Protecting particular host.

Application is using built in Nginx `auth_request` function. This mean every single HTTP request before it hit your
application will be authorised with external application.

To protect your application to Nginx config `server` section with host you want to protect you must add:

```editorconfig
server {
    location /nginx_rate_limit_check {
        internal;
        proxy_pass http://localhost:3001;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header X-Original-IP $remote_addr;
        proxy_set_header X-Original-Method $request_method;
    }
    
    location @error_rate_limit_reached {
        add_header Content-Type text/plain always;
        add_header Retry-After 20 always;
        return 429 "Too Many Requests";
    }
    
    auth_request /nginx_rate_limit_check;
    error_page 401 = @error_rate_limit_reached;
    
    ...below rest of config
}
```

With above config you're

- creating internal url `/nginx_rate_limit_check` - requests to this url are passed to rate limit application.
- passing to application additional information from current request like client IP address, HTTP method and request URI
- getting a response from application - if it's negative returning a HTTP 401, if positive request is passed to your
  protected application
- because 401 is Unauthorized, but you want 429 Too Many Requests instead, you re overwriting a HTTP code

## Inspirations

https://github.com/leandromoreira/nginx-lua-redis-rate-measuring

## Author

Arkadiusz Kuryłowicz 2021
