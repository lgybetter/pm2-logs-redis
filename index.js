'use strict';
const redis = require('redis');
const Promise = require('bluebird');
const moment = require('moment');

Promise.promisifyAll(redis.RedisClient.prototype);
Promise.promisifyAll(redis.Multi.prototype);

const pm2 = require('pm2');
const pmx = require('pmx');

const os = require('os');
let ips = [];
var network = os.networkInterfaces();
for(var dev in network){
  for(var i = 0; i < network[dev].length; i++) {
      var json = network[dev][i];
      if(json.family == 'IPv4') {
				ips.push(json.address);
      }
  }
}
let host = ips.sort().join(',');

console.log('host', host);

pmx.initModule({
  widget: {
    logo: 'http://semicomplete.com/presentations/logstash-monitorama-2013/images/elasticsearch.png',
    theme: ['#141A1F', '#222222', '#3ff', '#3ff'],
    el: {
      probes: false,
      actions: false
    },
    block: {
      actions: false,
      issues: false,
      meta: false,
    }
  }
}, (err, conf) => {
  if (err) {
      console.log('error', err);
      return;
  }
	const config = require('./config') || {};
	console.log(conf, config);


	let timeStampFormat = config.timeStampFormat || "";
	let redisKeyPrefix = config.redisKeyPrefix || "pm2logs";
	let redisOptions = config.redisOptions || "";
	let expire = config.expire || 7*24*60*60;

	let redisClient = redis.createClient(redisOptions);
	redisClient.on("error", function(error) {
    console.log(error);
	});

	const getRedisKeyName = () => {
		if(timeStampFormat){
			return redisKeyPrefix + moment().format(timeStampFormat);
		}else{
			return redisKeyPrefix;
		}
	}
	const makeMsg = (packet, source) => {
		return {
			"@timestamp": new Date(packet.at),
			"host": host,
			"message": packet.data,
			"pm2": {
        "name": packet.process.name,
				"source": source,
				"pm_id": packet.process.pm_id,
				"rev": packet.process.rev
			}
		};
	}
  pm2.connect(() => {
    console.log('info', 'PM2: forwarding to redis');

    pm2.launchBus((err, bus) => {
      bus.on('log:PM2', function (packet) {
				let msg = makeMsg(packet, 'stdout');
        console.log('log:PM2', msg, JSON.stringify(msg), packet.data);
				let redisKey = getRedisKeyName();
				redisClient.rpushAsync(redisKey, JSON.stringify(msg));
				redisClient.expireAsync(redisKey, expire);
      });
      bus.on('log:out', function (packet) {
				let msg = makeMsg(packet, 'stdout');
        console.log('log:out', msg, JSON.stringify(msg), packet.data);
				let redisKey = getRedisKeyName();
				redisClient.rpushAsync(redisKey, JSON.stringify(msg));
				redisClient.expireAsync(redisKey, expire);
      });
      bus.on('log:err', function (packet) {
				let msg = makeMsg(packet, 'stderr');
        console.log('log:err', msg, JSON.stringify(msg), packet.data);
				let redisKey = getRedisKeyName();
				redisClient.rpushAsync(redisKey, JSON.stringify(msg));
				redisClient.expireAsync(redisKey, expire);
      });
    });
  });

});
