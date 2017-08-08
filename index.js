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
    var url = $('.item-request #item-url').val();
    var days = $('.item-request #item-days').val();
    searchItem(url)
      .then(function (result) {
        Manager.pricingHistory = result.pricingHistory;
        if (Manager.charts) {
          Manager.charts.pricingChart.destroy();
          Manager.charts.rsiChart.destroy();
        }
        Manager.charts = performanceLogger(updateChart)(result.pricingHistory, days);
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

// Returns RSI data over a number of days.
function getRSI (data, sensitivity=14, days=7) {
  var set = [];
  var rs;
  var averageGain;
  var averageLoss;
  var sumOfGains = 0;
  var sumOfLosses = 0;
  var lastValue;
  if (data.length > sensitivity) {
    lastValue = data[0][1];
    for (var i = 1; i < data.length; i++) {
      let thisValue = data[i][1]
      if (i < sensitivity) {
        if (thisValue > lastValue) {
          sumOfGains += thisValue - lastValue;
        }
        else if (thisValue < lastValue) {
          sumOfLosses += lastValue - thisValue;
        }
      }
      if (i >= sensitivity) {
        // First Average Gain = Sum of Gains over the past N periods / N
        // First Average Loss = Sum of Losses over the past N periods / N
        if (i === sensitivity) {
          averageGain = sumOfGains / sensitivity;
          averageLoss = sumOfLosses / sensitivity;
        }
        else {
          // Average Gain = [(previous Average Gain) * (N-1) + Current Gain] / N
          // Average Loss = [(previous Average Loss) * (N-1) - Current Loss] / N
          if (thisValue > lastValue) {
            averageGain = (averageGain * (sensitivity - 1) + (thisValue - lastValue)) / sensitivity;
          }
          else if (thisValue < lastValue) {
            averageLoss = (averageLoss * (sensitivity - 1) + (lastValue - thisValue)) / sensitivity;
          }
        }
        // RS = Average Gain / Average Loss
        // Should the averageLoss be zero, RS is 100 by definition.
        // RSI = 100 - 100 / (1 + RS)
        rs = Math.min(averageGain / averageLoss, 100);
        rsi = 100 - 100 / (1 + rs);
        set.push([data[i][0], rsi]);
      }
      lastValue = thisValue;
    }
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

// A decorator function which logs the performance of its argument function.
function performanceLogger (f) {
  return function () {
    var start = performance.now();
    var result = f.apply(this, arguments);
    var end = performance.now();
    console.log(`${f.name} took ${(end - start).toFixed(2)}ms.`);
    return result;
  }
}

// Calculates all regressions and updates the chart.
function updateChart (data, days=7) {
  var rsiSensitivity = 14;
  var start = performance.now();
  var dataLows = performanceLogger(getLocalExtrema)(data, "min");
  var dataHighs = performanceLogger(getLocalExtrema)(data, "max");
  var regressionAll = performanceLogger(getLinearRegression)(data, days);
  var regressionLow = performanceLogger(getLinearRegression)(dataLows, days);
  var regressionHigh = performanceLogger(getLinearRegression)(dataHighs, days);
  var movingAverageN = $('#moving-average-n').val() || Math.min(Math.ceil(days / 2), 15);
  var movingAverageM = $('#moving-average-m').val() || Math.min(Math.ceil(movingAverageN * 3), 45);
  var movingAverage = performanceLogger(getMovingAverage)(data, movingAverageN, days);
  var movingAverageLong = performanceLogger(getMovingAverage)(data, movingAverageM, days);
  var rsi = performanceLogger(getRSI)(data, rsiSensitivity, days);
  var pricingCtx = $("#pricing-chart");
  var rsiCtx = $("#rsi-chart");
  var end = performance.now();

  var pricingChart = new Chart(pricingCtx, {
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
      'maintainAspectRatio': false,
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
            'beginAtZero': true,
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

  var rsiChart = new Chart(rsiCtx, {
    'type': 'scatter',
    'data': {
      'datasets': [
        {
          'label': `RSI`,
          'data': convertDataForChart(rsi),
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
      'maintainAspectRatio': false,
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
            var y = `${toolTipItem.yLabel.toFixed(2)}`;
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
            'beginAtZero': true,
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
            'beginAtZero': true,
            'max': 100
          },
          'gridLines': {
            'color': "rgba(255, 255, 255, 0.1)"
          }
        }]
      }
    }
  })

  return {pricingChart, rsiChart};
}