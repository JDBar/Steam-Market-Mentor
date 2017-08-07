const {remote, ipcRenderer} = require("electron");
const {shell} = remote;
const main = remote.require("./main.js");
const jQuery = require("jquery");
const $ = jQuery;
const request = require('request-promise-native');
const regression = require('regression');
const Chart = require('chart.js');
const moment = require('moment');
const Manager = {
  'pricingHistory': null,
  'chart': null
}

Chart.defaults.global.defaultFontColor = "#fff";

$(document).ready(function () {
  // Search Item button click.
  $('.item-request button').click(function () {
    var url = $('.item-request input').val();
    searchItem(url)
      .then(function (result) {
        Manager.pricingHistory = result.pricingHistory;
        if (Manager.chart) {
          Manager.chart.destroy();
        }
        Manager.chart = updateChart(result.pricingHistory, 15);
      })
      .catch(function (error) {
        $(".pricing-history").text(error);
      })
  })
})

// Gets information from a Steam Marketplace URL.
function searchItem (url) {
  // Return a promise for the pricing history.
  var promise = new Promise (function (resolve, reject) {
    url = validate(url, "market/listings/");
    if (url) {
      // Get the contents of the Marketplace item page.
      var pagePromise = request(url);
      var pricePromise = request(getPricingUrl(url));
      Promise.all([pagePromise, pricePromise])
        .then(function (results) {
          var html = results[0];
          var json = results[1];
          // Create a result object.
          var result = {
            'pricingHistory': null,
            'lowestPrice': null,
            'volume': null,
            'medianPrice': null
          };
          // Try to parse the pricing JSON.
          try {
            json = JSON.parse(json);
            if (json.success === false) {
              throw ("Pricing request was unsuccessful.")
            }
            result.lowestPrice = json.lowest_price;
            result.medianPrice = json.median_price;
            result.volume = json.volume;
          }
          catch (error) {
            // leave pricing results as null
          }
          // Search the HTML for the line of code containing pricing history.
          var regexp = /var line1=(\[.*\]);/m;
          var pricingHistoryCode = html.match(regexp);
          if (pricingHistoryCode && pricingHistoryCode.length === 2) {
            try {
              result.pricingHistory = JSON.parse(pricingHistoryCode[1]);
            }
            catch (error) {
              // leave result.pricingHistory as null.
            }
          }
          else {
            reject('Was unable to get pricing history.');
          }
          resolve(result);
        })
        .catch(function (error) {
          reject("Received an error from the Steam Marketplace.");
          console.log(error);
        })
    }
    else {
      reject('Marketplace item URL is invalid.');
    }
  })
  return promise;
}

// Converts a validated search URL to a pricing URL.
function getPricingUrl(url) {
  if (url.lastIndexOf("/") === url.length - 1) {
    url = url.slice(0, url.lastIndexOf("/"));
  }
  var urlSegments = url.split("/");
  var name = urlSegments.pop();
  var appid = urlSegments.pop();
  return `http://steamcommunity.com/market/priceoverview/?currency=1&appid=${appid}&market_hash_name=${name}`;
}

// A function to make sure a Marketplace URL is valid.
// The interface can be a Marketplace path such as "market/listings/"
function validate (url, interface="") {
  url = url.replace("https://", "http://");
  if (url.indexOf("http://") !== 0) {
    url = "http://" + url;
  }
  if (url.indexOf(`http://steamcommunity.com/${interface}`) == 0) {
    return url;
  }
  else {
    return null;
  }
}

// Returns a set of the local extrema of a data set.
// Second argument may be either "min" or "max".
function getLocalExtrema (data, type="max") {
  var f;
  function lessThan (a, b) {
    return a < b;
  }
  function greaterThan (a, b) {
    return a > b;
  }
  if (type === "max") {
    f = greaterThan;
  }
  else if (type === "min") {
    f = lessThan;
  }
  var set = [];
  for (var i = 0; i < data.length; i++) {
    let current = data[i][1];
    let next = data[i+1];
    let prev = data[i-1];
    if (typeof next !== "undefined" && typeof prev !== "undefined") {
      if (f(current, next[1]) && f(current, prev[1])) {
        set.push(data[i]);
      }
    }
    else if (typeof next !== "undefined" && f(current, next[1])) {
      set.push(data[i]);
    }
    else if (typeof prev !== "undefined" && f(current, prev[1])) {
      set.push(data[i]);
    }
  }
  return set;
}

// Returns the linear regression of a data set over a number of days.
// Data should be in the form of [Date, number]
function getLinearRegression (data, days) {
  if (typeof days !== "undefined") {
    data = getRecentData(data, days);
  }
  var reg = regression.linear(data);
  console.log(reg);
  return reg;
}

// Returns data for a moving average of amount over a number of days.
function getMovingAverage (data, amount=3, days=7) {
  // A recursive helper function for summing the previous num of entries in an array.
  function sumPrevious (index, num) {
    if (num <= 1) {
      return data[index][1];
    }
    else {
      return data[index][1] + sumPrevious(index - 1, num - 1)
    }
  }
  var set = [];
  for (var i = amount - 1; i < data.length; i++) {
    let sum = sumPrevious(i, amount);
    let average = sum / amount;
    set.push([data[i][0], average])
  }
  return getRecentData(set, days);
}

// Filters out the most recent pricing data in a set by number of days.
function getRecentData (data, days=7) {
  var set = [];
  var i = data.length - 1;
  var mostRecentDate = new Date();
  while (i >= 0) {
    let distance = moment(mostRecentDate).diff(data[i][0], 'days', true);
    if (distance <= days) {
      let day = days - distance;
      let price = data[i][1];
      set.unshift([day, price]);
      i--;
    }
    else {
      break;
    }
  }
  return set;
}

// Generates data from a formula y=mx+b
function generateDataFromRegression(reg, days) {
  var firstPointX = reg.points[0][0];
  var set = [];
  for (var i = firstPointX; i < days; i += days / 100) {
    set.push({
      'x': i,
      'y': reg.equation[0] * i + reg.equation[1]
    })
  }
  return set; 
}

// Converts data from [[x,y]] format to [{x,y}] format.
function convertDataForChart (data) {
  var set = [];
  for (var i = 0; i < data.length; i++) {
    set.push({
      'x': data[i][0],
      'y': data[i][1]
    })
  }
  return set;
}

// Calculates all regressions and updates the chart.
function updateChart (data, days=7) {
  var dataLows = getLocalExtrema(data, "min");
  var dataHighs = getLocalExtrema(data, "max");
  var regressionAll = getLinearRegression(data, days);
  var regressionLow = getLinearRegression(dataLows, days);
  var regressionHigh = getLinearRegression(dataHighs, days);
  var movingAverageN = Math.ceil(days / 2);
  var movingAverageM = movingAverageN * 3;
  var movingAverage = getMovingAverage(data, movingAverageN, days);
  var movingAverageLong = getMovingAverage(data, movingAverageM, days);
  var ctx = $("#pricing-chart");
  return new Chart(ctx, {
    'type': 'scatter',
    'data': {
      'datasets': [
        {
          'label': `Moving Average ${movingAverageN}`,
          'data': convertDataForChart(movingAverage),
          'pointRadius': 0,
          'pointHitRadius': 10,
          'pointHoverRadius': 10,
          'backgroundColor': 'rgba(0, 0, 0, 0)',
          'borderColor': 'rgba(255, 255, 0, 0.7)',
          'borderWidth': 2
        },
        {
          'label': `Moving Average ${movingAverageM}`,
          'data': convertDataForChart(movingAverageLong),
          'pointRadius': 0,
          'pointHitRadius': 10,
          'pointHoverRadius': 10,
          'backgroundColor': 'rgba(0, 0, 0, 0)',
          'borderColor': 'rgba(255, 0, 255, 0.7)',
          'borderWidth': 2
        },
        {
          'label': 'Regression',
          'data': generateDataFromRegression(regressionAll, days),
          'pointRadius': 0,
          'pointHitRadius': 10,
          'pointHoverRadius': 10,
          'backgroundColor': 'rgba(0, 0, 0, 0)',
          'borderColor': 'rgba(255, 0, 0, 0.7)',
          'borderWidth': 2
        },
        {
          'label': 'Regression Highs',
          'data': generateDataFromRegression(regressionHigh, days),
          'pointRadius': 0,
          'pointHitRadius': 10,
          'pointHoverRadius': 10,
          'backgroundColor': 'rgba(0, 0, 0, 0)',
          'borderColor': 'rgba(0, 0, 255, 0.7)',
          'borderWidth': 2
        },
        {
          'label': 'Regression Lows',
          'data': generateDataFromRegression(regressionLow, days),
          'pointRadius': 0,
          'pointHitRadius': 10,
          'pointHoverRadius': 10,
          'backgroundColor': 'rgba(0, 0, 0, 0)',
          'borderColor': 'rgba(0, 255, 255, 0.7)',
          'borderWidth': 2
        },
        {
          'label': 'Pricing History',
          'data': convertDataForChart(getRecentData(data, days)),
          'pointRadius': 0,
          'pointHitRadius': 10,
          'pointHoverRadius': 10,
          'backgroundColor': 'rgba(0, 0, 0, 0)',
          'borderColor': 'rgba(0, 255, 0, 0.9)',
          'borderWidth': 3,
          'lineTension': 0
        }
      ]
    },
    'options': {
      'layout': {
        'padding': 20
      },
      'legend': {
        'labels': {
          'fontColor': 'rgba(255, 255, 255, 1)'
        }
      },
      'tooltips': {
        'mode': 'nearest',
        'callbacks': {
          'label': function (toolTipItem, data) {
            var x = `${moment().subtract(days - toolTipItem.xLabel, 'days').format('MMM Do')}`
            var y = `$${toolTipItem.yLabel.toFixed(2)}`;
            return `${x}, ${y}`
          }
        } 
      },
      'scales': {
        'scaleLabel': {
          'fontColor': 'rgba(255, 255, 255, 1)'
        },
        'xAxes': [{
          'ticks': {
            'callback': function (value, index, values) {
              return moment().subtract(days - value, 'days').format('MMM Do');
            }
          },
          'gridLines': {
            'color': "rgba(255, 255, 255, 0.1)"
          },
        }],
        'yAxes': [{
          'ticks': {
            'callback': function (value, index, values) {
              return `$${value.toFixed(2)}`;
            }
          },
          'gridLines': {
            'color': "rgba(255, 255, 255, 0.1)"
          }
        }]
      }
    }
  })
}