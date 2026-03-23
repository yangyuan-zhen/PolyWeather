$(function() {
  var myTabs = tabs({
    el: '#infotabs',
    tabNavigationLinks: '.c-tabs-nav__link',
    tabContentContainers: '.c-tab'
  });
  myTabs.init();
  $('#container').html('<center><img src="/images/slc/common_images/spinner.gif"></center>'); 
  // Sanitization
  var ARGS = window.location.search.toLowerCase().replace('?','');
  if (ARGS) {
    console.log('Parameters detected')
    ARGS = ARGS.replaceAll('%20','');
    console.log(ARGS);
    var args = ARGS.split('&');
    var site = '';
    var numHours = '72';
    var units = 'english';
    var chart ='on';
    var headers = 'on';
    var format = 'tabular';
    var hourly='false';
    var history = 'no';
    var pview = 'standard';
    var start = '';
    var end = '';
    var plot = '';
    var fontSize = 12;
    for (i = 0; i < args.length; i++) {
      var chunk = args[i].split('=');
      if (chunk[0]=='site') {
        if (1 < chunk[1].length && chunk[1].length < 10) {
          site = chunk[1];
        } else {
          popup();
        }
      } else if (chunk[0]=='hours') {
        if (isNaN(chunk[1])) {
          popup();
        } else {
          numHours = parseInt(chunk[1]);        
          if (1 > numHours || numHours > 720) {
            popup(site);
          }
        }
      } else if (chunk[0]=='units') {
        if (chunk[1] == 'metric' || chunk[1] == 'english' || chunk[1] == 'english_k') {
          units = chunk[1]
        } else {
          popup(site);
        }
      } else if (chunk[0]=='chart') {
        if (chunk[1] == 'off') {
          chart=chunk[1];
          $('#container').hide();
        } else if (chunk[1] == 'on') {
          chart=chunk[1]; 
        } else{
          popup(site);
        }
      } else if (chunk[0]=='obs') {
        if (chunk[1] == 'raw' || chunk[1] == 'tabular') {
          format = chunk[1];
        } else {
          popup(site);
        }  
      } else if (chunk[0]=='font') {
        if (parseInt(chunk[1])) {
          fontSize = chunk[1];
        } else {
          popup(site);
        }  
      } else if (chunk[0]=='hourly') {
        if (chunk[1] == 'true' || chunk[1] == 'false') {
          hourly = chunk[1];
        } else {
          popup(site);
        }  
      } else if (chunk[0]=='headers') {
        if (chunk[1] == 'none' || chunk[1] == 'min' || chunk[1] == 'on') {
          headers = chunk[1];
        } else {
          popup(site);
        }  
      } else if (chunk[0]=='pview') {
        if (chunk[1] == 'standard' || chunk[1] == 'full' || chunk[1] == 'measured') {
          pview = chunk[1];
        } else {
          popup(site);
        }  
      } else if (chunk[0]=='plot') {
        plot = chunk[1];
      } else if (chunk[0]=='fbclid') {
        console.log('Facebook reference')
      } else if (chunk[0] == 'start' && parseInt(chunk[1])) {
        start = chunk[1];
      } else if (chunk[0] == 'end' && parseInt(chunk[1])) {
        end = chunk[1]; 
      } else if (chunk[0] == 'history' && chunk[1] == 'yes') {
        history = 'yes'; 
      } else {
        popup(site);
      }
    }
    if (!fontSize) {
      fontSize = parseInt($('#OBS_DATA').css('font-size'));
    }
    if (site != '') {
      $('#LBSITE').html('Users with low bandwidth, low computing power, or older devices may wish to click <a href="/wrh/LowTimeseries?site='+site+'"> here </a>.');
      monitorOBS(site,numHours,units,format,headers,chart,hourly,history,start,end,pview,fontSize,plot) 
    } else {
      popup();
    }
  } else {
    popup();
  } 
  $('#HISTORY').click(function() {
    if(this.checked) {
    $('#STARTDATE').show();
    $('#STARTDATE').datepicker({
      altField: "#actualDate",
      dateFormat: "yy-mm-dd",
      maxDate: new Date, 
      onSelect:function (selectedDate) {
        var MIN = new Date(selectedDate.split('-')[0], parseInt(selectedDate.split('-')[1]) - 1, selectedDate.split('-')[2]);
        var MAX = new Date(selectedDate.split('-')[0], parseInt(selectedDate.split('-')[1]) - 1, selectedDate.split('-')[2]);
            MAX.setDate(MAX.getDate()+29)
        $('#ENDDATE').datepicker({
          dateFormat: "yy-mm-dd",
          minDate: MIN,
          maxDate: MAX
        })
        $('#ENDDATE').show();
      }
    });
    } else {
      $('#STARTDATE').hide();
      $('#ENDDATE').hide();
    }
  });
  // CSS hiding parts of the web page
  $('.topnav').html('');                                   // HOME|FORECAST|PAST WX|SAFETY|INFO|EDUCATION|NEW|SEARCH|ABOUT    
  $('.topnav').css({'display': 'none', 'height' : '0px'}); // ''
  $('#forecast-lookup').css({'display': 'none'});          // Local forecast by "City, St" or ZIP code
  $('.five-sixth-last').css({'display': 'none'});          // "Top News"
  $('.subMenuNav').html('');                               // WR  : Local Forecast Offices A-K|Local Forecast Offices L-Z|River Forecast Centers|Center Weather Service Units|Regional HQ 
                                                           // WFOs: Cur Hazards|Cur Conditions|Radar|Forecasts|Rivers/Lakes|Climate|LocalPrograms
  $('#myfcst-widget').hide();                              // Customize Your Weather.gov
  $('.five-sixth-first').css({'width' : '100%', 'padding-right': '0px', 'padding-left': '0px'});  // Add space from "Customize Your Weather.gov" to full width of page  
  $('.full-width-first').html('');                                   // FaceBook|Twitter|YouTube|RSS    
  $('.full-width-first').css({'display': 'none', 'height' : '0px'}); // ''
  $('.footer').html('');                                             // Hide "Footer"    
  $('.footer').css({'display': 'none', 'height' : '0px'});           // ''
  $('.full-width-border').css({'border-top' : 'white'});             // ''
  $('.partial-width-borderbottom').css({'border-bottom' : 'white'}); // ''
 
  buildCustomMenu(SITE,numHours,units,format,headers,chart,hourly,history,start,end,pview,fontSize,plot)
  $('#options').dialog({
    modal: true,
    width: "75%",
    maxWidth: "1000px",
    autoOpen: false,
    title: "Advanced Settings ",
    closeOnEscape: true,
    show: { effect: "fade", duration: 800 }
  });
  $('#ABOUT').dialog({
    modal: true,
    width: "75%",
    maxWidth: "1000px",
    autoOpen: false,
    title: "About this page ",
    closeOnEscape: true,
    show: { effect: "fade", duration: 800 }
  });
  $('#SETTINGS').click(function() {
    $('#options').dialog('open');
  });
  $('#info').click(function() {
    $('#ABOUT').dialog('open');
  });
  // Toggles
  $('#unitsToggle').click(function() {
    if (units == 'english') {
      units = 'metric';
    } else if (units == 'metric') {
      units = 'english_k';
    } else {
      units = 'english';
    }
    //var fontSize = parseInt($('#OBS_DATA').css('font-size'));
    monitorOBS(site,numHours,units,format,headers,chart,hourly,history,start,end,pview,fontSize,plot);
  })
  $('#dataToggle').click(function() {
    if (hourly == 'true') {
      hourly = 'false';
    } else {
      hourly = 'true';
    }
    //var fontSize = parseInt($('#OBS_DATA').css('font-size'));
    monitorOBS(site,numHours,units,format,headers,chart,hourly,history,start,end,pview,fontSize,plot);
  })
  $('#obsToggle').click(function() {
    if (format == 'raw') {
      format = 'tabular';
    } else {
      format = 'raw';
    }
    //var fontSize = parseInt($('#OBS_DATA').css('font-size'));
    monitorOBS(site,numHours,units,format,headers,chart,hourly,history,start,end,pview,fontSize,plot);
  })
  $('#hoursToggle').click(function() {
    if (numHours < 168) {
      numHours = 168;
    } else {
      numHours = 72;
    }
    //var fontSize = parseInt($('#OBS_DATA').css('font-size'));
    monitorOBS(site,numHours,units,format,headers,chart,hourly,history,start,end,pview,fontSize,plot);
  })
  $('#smallFont').click(function() {
    //var fontSize = parseInt($('#OBS_DATA').css('font-size'));
    console.log(fontSize);
    fontSize = parseInt(fontSize) -1;
    //$('#OBS_DATA').css({'font-size': fontSize});
    resizePage(fontSize);
  })
  $('#resetFont').click(function() {
    //$('#OBS_DATA').css({'font-size': 12});
    fontSize = 12;
    resizePage(fontSize);
  })
  $('#bigFont').click(function() {
    //var fontSize = parseInt($('#OBS_DATA').css('font-size'));
    console.log(fontSize);
    fontSize = parseInt(fontSize) +1;
    //$('#OBS_DATA').css({'font-size': fontSize});
    resizePage(fontSize);
  })
})

function popup(site) {
  if (!site) {
    site = 'kslc'
  }
  alert('Something is wrong!\n Valid arguments are "site"\n followed by a valid 2-6 letter identifier\n and optional arguments are:\n "hours" followed by an integer between 1 and 720\n "units" followed by "english", "english_k", or "metric" \n "obs" followed by  "raw" (For ASOS/AWOS or Global METAR locations only)\n "headers" followed by "min" or "none"\n "chart" followed by "on" or "off"\n "hourly" followed by "true" or "false"\n "font" followed by an integer \n "pview" followed by "standard", "full" or "measured" \n Example:\nhttps://www.weather.gov/wrh/timeseries?site=kslc&hours=48&units=english&obs=raw&headers=off&chart=on&hourly=true&pview=full');
  window.location.href = 'https://www.weather.gov/wrh/timeseries?site='+site;
}

function monitorOBS(SITE,numHours,units,format,headers,chart,hourly,history,start,end,pview,fontSize,plot) {
  SITE = SITE.toUpperCase();
  console.log(SITE,numHours,units,format,headers,chart,hourly,history,start,end,pview,fontSize,plot);
  window.setTimeout(function () {
    //var fontSize = parseInt($('#OBS_DATA').css('font-size'));
    monitorOBS(SITE,numHours,units,format,headers,chart,hourly,history,start,end,pview,fontSize,plot) 
  }, 300000);
  if (history == 'yes') {
    numHours = 720;
  }
  // Build out select dropdown for charts
  $(".plot_select").empty();
  $(".plot_select").append("<option selected='selected' value=''>Select Graph ......</option>");
  $(".perm_select").empty();
  $(".perm_select").append("<option selected='selected' value=''>Select Graph ......</option>");
  // Toggle certain variables
  if (units == 'english') {
    $('#unitsToggle').html('Switch to Metric Units');
  } else if (units == 'metric') {
    $('#unitsToggle').html('Switch to US Units w/ kts');
  } else {
    $('#unitsToggle').html('Switch to US Units w/ mph');
  }
  if (hourly == 'true') {
    $('#dataToggle').html('Show All Data');
  } else {
    $('#dataToggle').html('Show Hourly Data');
  }
  if (format == 'raw') {
    $('#obsToggle').html('Decoded Observations');
  } else {
    $('#obsToggle').html('Raw Observations');
  }
  if (numHours < 73) {
    $('#hoursToggle').html('7 Days');
  } else {
    $('#hoursToggle').html('3 Days');
  }
  $('#SITE').html('<input type="hidden" value="'+SITE+'" name="SITE">');
  var numMinutes = numHours * 60;
  if (history != 'yes') {
    if (units == 'english') {
      var InfoToGet = 'https://api.synopticdata.com/v2/stations/timeseries?STID='+SITE+'&showemptystations=1&units=temp|F,speed|mph,english&recent='+numMinutes+'&complete=1&token='+mesoToken+'&obtimezone=local';
    } else if (units == 'english_k') {
      var InfoToGet = 'https://api.synopticdata.com/v2/stations/timeseries?STID='+SITE+'&showemptystations=1&units=temp|F,speed|kts,english&recent='+numMinutes+'&complete=1&token='+mesoToken+'&obtimezone=local';
    } else if (units == 'metric') {
      var InfoToGet = 'https://api.synopticdata.com/v2/stations/timeseries?STID='+SITE+'&showemptystations=1&recent='+numMinutes+'&complete=1&token='+mesoToken+'&obtimezone=local';
    }
  } else {
    if (units == 'english') {
      var InfoToGet = 'https://api.synopticdata.com/v2/stations/timeseries?STID='+SITE+'&showemptystations=1&units=temp|F,speed|mph,english&start='+start+'0000&end='+end+'2359&complete=1&token='+mesoToken+'&obtimezone=local';
    } else if (units == 'english') {
      var InfoToGet = 'https://api.synopticdata.com/v2/stations/timeseries?STID='+SITE+'&showemptystations=1&units=temp|F,speed|kts,english&start='+start+'0000&end='+end+'2359&complete=1&token='+mesoToken+'&obtimezone=local';
    } else if (units == 'metric') {
      var InfoToGet = 'https://api.synopticdata.com/v2/stations/timeseries?STID='+SITE+'&showemptystations=1&start='+start+'0000&end='+end+'2359&complete=1&token='+mesoToken+'&obtimezone=local';
    }
  }
  console.log(InfoToGet);
  $.getJSON(InfoToGet, function(DATA) {
    if (DATA.SUMMARY.RESPONSE_MESSAGE == "OK") {
      // Metadata
      var stnID   = DATA.STATION[0].STID;
      var stnNAM  = DATA.STATION[0].NAME;
      document.title = stnNAM;
      if (headers == 'on') {
        $('.location-pagetitle').html(stnNAM);
      } else {
        $('#icons').hide;
        $('.header').html('');                                   // NOAA BANNER
        $('.header').css({'display': 'none', 'height' : '0px'}); // '' 
        $('.center-content').html('');                           //
        $('.footer').html('');                                   //
        $('.footer-legal').html('');                             //
      }
      var stnLAT  = DATA.STATION[0].LATITUDE;
      var stnLON  = DATA.STATION[0].LONGITUDE
      var stnELE  = DATA.STATION[0].ELEVATION;
      var state   = DATA.STATION[0].STATE;
      var cwa     = DATA.STATION[0].CWA;
      var network = DATA.STATION[0].SHORTNAME;
      console.log(network);
      var NETWORK = network.toUpperCase();
      var nwsZone = DATA.STATION[0].NWSZONE;
      if (network == 'GLOBAL-METAR') {
        network = 'ASOS/AWOS';
      }
      if (network == 'ASOS/AWOS') {
        $('#obsToggle').show();
      } else {
        $('#obsToggle').hide();
      } 
      // Needed for stuff we need to derive
      var derived = 0;
      var accum_true = 0;
      var has_speed = 0;
      var has_precip = 0;
      var has_pressure = 0;

      // Building block for datasets
      var EngHeader = '<table id="OBS_DATA"><thead><tr id="HEADER"><th>Date/Time<br>&nbsp;<br>(L)</th>';
      var MetHeader = '<table id="OBS_DATA"><thead><tr id="HEADER"><th>Date/Time<br>&nbsp;<br>(L)</th>';
      var stamps = '';
 
      if (DATA.STATION[0].hasOwnProperty('OBSERVATIONS') && DATA.STATION[0].OBSERVATIONS.hasOwnProperty('date_time')) {
        stamps = DATA.STATION[0].OBSERVATIONS.date_time;
        //console.log(stamps)
        var numObs = DATA.STATION[0].OBSERVATIONS.date_time.length;
        numObs = numObs - 1;
        var tableData = '';
        // Loop through each observation
        var METARString = '<table id="OBS">';
        for (j = numObs; j > -1; j--) { 		
          // Date and time
          var MW_TIMESTAMP = DATA.STATION[0].OBSERVATIONS.date_time[j];
          var TIMEZONE = DATA.STATION[0].TIMEZONE;
          var timestamp = moment(MW_TIMESTAMP).tz(TIMEZONE).format('MMM D, h:mm a')
          var hours     = moment(MW_TIMESTAMP).tz(TIMEZONE).format('h');
              hours     = parseInt(hours);
          var minutes   = moment(MW_TIMESTAMP).tz(TIMEZONE).format('mm');

          // Temperature
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('air_temp_set_1')) {
            var ATData = DATA.STATION[0].OBSERVATIONS.air_temp_set_1;
            if (j == 0) {
              plot_menu("temperature","Temperature");
              EngHeader += '<th id="temperature" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.air_temp_set_1+'\',\'Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Temp.<br>&nbsp;<br>(&deg;F)</th>';
              MetHeader += '<th id="temperature" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.air_temp_set_1+'\',\'Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Temp.<br>&nbsp;<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.air_temp_set_1[j] !== null) {
              var TEMP_F = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.air_temp_set_1[j])+'</td>';
            } else {
              var TEMP_F = '<td>&nbsp;</td>';
            }
          } else {
            var TEMP_F = '';
          }
          // Dew Point
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('dew_point_temperature_set_1d')) {
            if (j == 0) {
              plot_menu("dewpt","Dew Point");
              EngHeader += '<th id="dewpt" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.dew_point_temperature_set_1d+'\',\'Dew Point Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Dew<br>Point<br>(&deg;F)</th>';
              MetHeader += '<th id="dewpt" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.dew_point_temperature_set_1d+'\',\'Dew Point Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Dew<br>Point<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.dew_point_temperature_set_1d[j] !== null) {
              var DEWPOINT = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.dew_point_temperature_set_1d[j])+'</td>';
            } else {
              var DEWPOINT = '<td>&nbsp;</td>';
            }
          } else {
            var DEWPOINT = '';
          }
          // Relative Humidity
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('relative_humidity_set_1')) {
            if (j == 0) {
              plot_menu("rh","Relative Humidity");
              EngHeader += '<th id="rh" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.relative_humidity_set_1+'\',\'Relative Humidity\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Relative<br>Humidity<br>(%)</th>';
              MetHeader += '<th id="rh" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.relative_humidity_set_1+'\',\'Relative Humidity\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Relative<br>Humidity<br>(%)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.relative_humidity_set_1[j] !== null) {
              var RH_PCT = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.relative_humidity_set_1[j])+'</td>';
            } else {
              var RH_PCT = '<td>&nbsp;</td>';
            }
          } else {
            var RH_PCT = '';
          }
          // Heat Index
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('heat_index_set_1d')) {
            if (j == 0) {
              plot_menu("heat_index","Heat Index");
              EngHeader += '<th id="heat_index" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.heat_index_set_1d+'\',\'Heat Index\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Heat<br>Index<br>(&deg;F)</th>';
              MetHeader += '<th id="heat_index" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.heat_index_set_1d+'\',\'Heat Index\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Heat<br>Index<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.heat_index_set_1d[j] !== null) {
              var HI = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.heat_index_set_1d[j])+'</td>';
            } else {
              var HI = '<td>&nbsp;</td>';
            }
          } else {
            var HI = '';
          }
          // Wind Chill
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('wind_chill_set_1d')) {
            if (j == 0) {
              plot_menu("wind_chill","Wind Chill");
              EngHeader += '<th id="wind_chill" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_chill_set_1d+'\',\'Wind Chill\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Wind<br>Chill<br>(&deg;F)</th>';
              MetHeader += '<th id="wind_chill" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_chill_set_1d+'\',\'Wind Chill\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Wind<br>Chill<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.wind_chill_set_1d[j] !== null) {
              var WC = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.wind_chill_set_1d[j])+'</td>';
            } else {
              var WC = '<td>&nbsp;</td>';
            }
          } else {
            var WC = '';
          }
          // Wind Direction
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('wind_direction_set_1')) {
            if (j == 0) {
              plot_menu("wind_dir","Wind Direction");
              EngHeader += '<th id="wind_dir" class="zoom" title="Click to view chart" onclick="makeWindChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_speed_set_1+'\',\'Wind Speed & Gusts\',\''+units+'\',\''+TIMEZONE+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_gust_set_1+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_direction_set_1+'\',\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Wind<br>Direction<br>&nbsp;</th>';
              MetHeader += '<th id="wind_dir" class="zoom" title="Click to view chart" onclick="makeWindChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_speed_set_1+'\',\'Wind Speed & Gusts\',\''+units+'\',\''+TIMEZONE+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_gust_set_1+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_direction_set_1+'\',\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Wind<br>Direction<br>&nbsp;</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.wind_cardinal_direction_set_1d[j] !== null) {
              var Wind_DIR = (DATA.STATION[0].OBSERVATIONS.wind_cardinal_direction_set_1d[j]);
              var WIND_DIR = '<td>'+Wind_DIR+'</td>';
            } else {
                var WIND_DIR = '<td>&nbsp;</td>';
            }
          } else {
            var WIND_DIR = '';
          }
          // Wind Speed & Gust
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('wind_speed_set_1')) {
            var has_speed=1;
            if (j == 0) {
                plot_menu("wind_speedgust","Wind Speed & Gusts");
              if (units == 'english') {
                EngHeader += '<th id="wind_speedgust" class="zoom" title="Click to view chart" onclick="makeWindChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_speed_set_1+'\',\'Wind Speed & Gusts\',\''+units+'\',\''+TIMEZONE+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_gust_set_1+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_direction_set_1+'\',\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Wind<br>Speed<br>(mph)</th>';
              } else if (units == 'english_k') {
                EngHeader += '<th id="wind_speedgust" class="zoom" title="Click to view chart" onclick="makeWindChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_speed_set_1+'\',\'Wind Speed & Gusts\',\''+units+'\',\''+TIMEZONE+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_gust_set_1+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_direction_set_1+'\',\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Wind<br>Speed<br>(kts)</th>';
              }
              MetHeader += '<th id="wind_speedgust" class="zoom" title="Click to view chart" onclick="makeWindChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_speed_set_1+'\',\'Wind Speed & Gusts\',\''+units+'\',\''+TIMEZONE+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_gust_set_1+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_direction_set_1+'\',\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Wind<br>Speed<br>(kph)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.wind_speed_set_1[j] !== null) {
              if (units == 'english' || units == 'english_k') {
                var WIND_SPD = Math.round(DATA.STATION[0].OBSERVATIONS.wind_speed_set_1[j]);
                if (WIND_SPD < 20 ) {
                  WIND_SPD = '<td>'+WIND_SPD;
                } else if (WIND_SPD < 40 ) {
                  WIND_SPD = '<td><font color="blue">'+WIND_SPD+'</font>';
                } else if (WIND_SPD < 58 ) {
                  WIND_SPD = '<td><font color="red">'+WIND_SPD+'</font>';
                } else {
                  WIND_SPD = '<td><font color=#FF00FF>'+WIND_SPD+'</font>';
                }
              } else {
                var WIND_SPD = Math.round((DATA.STATION[0].OBSERVATIONS.wind_speed_set_1[j])*3.6);
                if (WIND_SPD < 32 ) {
                  WIND_SPD = '<td>'+WIND_SPD;
                } else if (WIND_SPD < 64 ) {
                  WIND_SPD = '<td><font color="blue">'+WIND_SPD+'</font>';
                } else if (WIND_SPD < 93 ) {
                  WIND_SPD = '<td><font color="red">'+WIND_SPD+'</font>';
                } else {
                  WIND_SPD = '<td><font color=#FF00FF>'+WIND_SPD+'</font>';
                }
              }
            } else {
              var WIND_SPD = '<td>&nbsp;';
            }
            if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('wind_gust_set_1')) {
              if (DATA.STATION[0].OBSERVATIONS.wind_gust_set_1[j] !== null) {
                if (units == 'english' || units == 'english_k') {
                  var WIND_GST =Math.round(DATA.STATION[0].OBSERVATIONS.wind_gust_set_1[j]);
                  if (WIND_GST < 11 ) {
                    WIND_SPD += 'G'+WIND_GST+'</td>';
                  } else if (WIND_GST < 12 ) {
                    WIND_SPD += '<font color="blue">G'+WIND_GST+'</font></td>';
                  } else if (WIND_GST < 13 ) {
                    WIND_SPD += '<font color="red">G'+WIND_GST+'</font></td>';
                  } else {
                    WIND_SPD += '<font color=#FF00FF>G'+WIND_GST+'</font></td>';
                  }
                } else {
                  var WIND_GST =Math.round((DATA.STATION[0].OBSERVATIONS.wind_gust_set_1[j])*3.6);
                  if (WIND_GST < 17) {
                    WIND_SPD += 'G'+WIND_GST+'</td>';
                  } else if (WIND_GST < 19 ) {
                    WIND_SPD += '<font color="blue">G'+WIND_GST+'</font></td>';
                  } else if (WIND_GST < 21 ) {
                    WIND_SPD += '<font color="red">G'+WIND_GST+'</font></td>';
                  } else {
                    WIND_SPD += '<font color=#FF00FF>G'+WIND_GST+'</font></td>';
                  }
                }
              } else {
                WIND_SPD += '</td>';
              }
            }
          } else {
            var WIND_SPD = '';
          }
          // Wind Gust, where there is no speed ...
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('wind_gust_set_1')) {
            if (has_speed == 0) {
              if (j == 0) {
                plot_menu("wind_gust","Wind Gusts");
                EngHeader += '<th id="wind_gust" class="zoom" title="Click to view chart" onclick="makeWindChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_speed_set_1+'\',\'Wind Speed & Gusts\',\''+units+'\',\''+TIMEZONE+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_gust_set_1+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_direction_set_1+'\',\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Wind<br>Gust<br>(mph)</th>';
                MetHeader += '<th id="wind_gust" class="zoom" title="Click to view chart" onclick="makeWindChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_speed_set_1+'\',\'Wind Speed & Gusts\',\''+units+'\',\''+TIMEZONE+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_gust_set_1+'\',\''+DATA.STATION[0].OBSERVATIONS.wind_direction_set_1+'\',\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Wind<br>Gust<br>(kph)</th>';
              }
              if (DATA.STATION[0].OBSERVATIONS.wind_gust_set_1[j] !== null) {
                if (units == 'english') {
                  var WIND_GST =Math.round(DATA.STATION[0].OBSERVATIONS.wind_gust_set_1[j]);
                  if (WIND_GST < 11 ) {
                    var WIND_GUST = '<td>'+WIND_GST+'</td>';
                  } else if (WIND_GST < 12 ) {
                    var WIND_GUST = '<td><font color="blue">'+WIND_GST+'</font></td>';
                  } else if (WIND_GST < 13 ) {
                    var WIND_GUST = '<td><font color="red">'+WIND_GST+'</font></td>';
                  } else {
                    var WIND_GUST = '<td><font color=#FF00FF>G'+WIND_GST+'</font></td>';
                  }
                } else {
                  var WIND_GST =Math.round((DATA.STATION[0].OBSERVATIONS.wind_gust_set_1[j])*3.6);
                  if (WIND_GST < 17 ) {
                    var WIND_GUST = '<td>'+WIND_GST+'</td>';
                  } else if (WIND_GST < 19 ) {
                    var WIND_GUST = '<td><font color="blue">'+WIND_GST+'</font></td>';
                  } else if (WIND_GST < 21 ) {
                    var WIND_GUST = '<td><font color="red">'+WIND_GST+'</font></td>';
                  } else {
                    var WIND_GUST = '<td><font color=#FF00FF>G'+WIND_GST+'</font></td>';
                  }
                }
              } else {
                var WIND_GUST = '<td>&nbsp;</td>';
              }
            } else {
              var WIND_GUST ='';
            }
          } else {
            var WIND_GUST ='';
          }
          // Fuel Temperature 
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('fuel_temp_set_1')) {
            if (j == 0) {
              plot_menu("fuel_temp","Fuel Temperature");
              EngHeader += '<th id="fuel_temp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.fuel_temp_set_1+'\',\'Fuel Temperature\',\''+units+'\',\''+TIMEZONE+'\',\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Fuel<br>Temp.<br>(&deg;F)</th>';
              MetHeader += '<th id="fuel_temp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.fuel_temp_set_1+'\',\'Fuel Temperature\',\''+units+'\',\''+TIMEZONE+'\',\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Fuel<br>Temp.<br>(&deg;F)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.fuel_temp_set_1[j] !== null) {
              var FUEL_T = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.fuel_temp_set_1[j])+'</td>';
            } else {
              var FUEL_T = '<td>&nbsp;</td>';
            }
          } else {
            var FUEL_T = '';
          }
          // Fuel Moisture
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('fuel_moisture_set_1')) {
            if (j == 0) {
                plot_menu("fuel_moisture","Fuel Moisture");
              EngHeader += '<th id="fuel_moisture" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.fuel_moisture_set_1+'\',\'Fuel Moisture\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Fuel<br>Moisture<br>(%)</th>';
              MetHeader += '<th id="fuel_moisture" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.fuel_moisture_set_1+'\',\'Fuel Moisture\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Fuel<br>Moisture<br>(%)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.fuel_moisture_set_1[j] !== null) {
              var FUEL_PCT = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.fuel_moisture_set_1[j])+'</td>';
            } else {
              var FUEL_PCT = '<td>&nbsp;</td>';
            }
          } else {
            var FUEL_PCT = '';
          }
          // Visibility
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('visibility_set_1')) {
            if (j == 0) {
                plot_menu("vsby","Visibility");
              EngHeader += '<th id="vsby" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.visibility_set_1+'\',\'Visibility\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Visibility<br>&nbsp;<br>(miles)</th>';
              MetHeader += '<th id="vsby" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.visibility_set_1+'\',\'Visibility\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Visibility<br>&nbsp;<br>(km)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.visibility_set_1[j] !== null) {
              if (units == 'metric') {
                var VISIBILITY =((DATA.STATION[0].OBSERVATIONS.visibility_set_1[j])*1.609).toFixed(1);
                if (VISIBILITY <= 1.6 ) {
                  VISIBILITY = '<td><font color=#FF00FF>'+VISIBILITY.replace('-','< ')+'</font></td>';
                } else if (VISIBILITY <= 5  ) {
                  VISIBILITY = '<td><font color="#FF0000">'+VISIBILITY+'</font></td>';
                } else if (VISIBILITY < 11) {
                  VISIBILITY = '<td><font color="#FF8800">'+Math.round(VISIBILITY)+'</font></td>';
                } else {
                  VISIBILITY = '<td>'+Math.round(VISIBILITY)+'</td>';
                }
              } else {
                var VISIBILITY =(DATA.STATION[0].OBSERVATIONS.visibility_set_1[j]).toFixed(2);
                if (VISIBILITY <= 1 ) {
                  VISIBILITY = '<td><font color=#FF00FF>'+VISIBILITY.replace('-','< ')+'</font></td>';
                } else if (VISIBILITY <= 3  ) {
                  VISIBILITY = '<td><font color="#FF0000">'+VISIBILITY+'</font></td>';
                } else if (VISIBILITY < 7) {
                  VISIBILITY = '<td><font color="#FF8800">'+VISIBILITY+'</font></td>';
                } else {
                  VISIBILITY = '<td>'+VISIBILITY+'</td>';
                }
              }
            } else {
              var VISIBILITY = '<td>&nbsp;</td>';
            }
          } else {
            var VISIBILITY = '';
          }
          // Present Weather
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('weather_cond_code_set_1')) {
            if (j == 0) {
              EngHeader += '<th>Weather<br>&nbsp;<br>&nbsp;</th>';
              MetHeader += '<th>Weather<br>&nbsp;<br>&nbsp;</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.weather_cond_code_set_1[j] !== null) {
              if (network == 'ASOS/AWOS') {
                var WEATHER = parseInt(DATA.STATION[0].OBSERVATIONS.weather_cond_code_set_1[j]);
                if (WEATHER < 80) { 		//
                  WX_ELEM1 = getWeatherCode(WEATHER);
                  WX_ELEM2 = '';
                  WX_ELEM3 = '';
                } else if (WEATHER < 6400) {
                  WX1 = Math.floor (WEATHER / 80);
                  WX_ELEM1 = getWeatherCode(WX1);
                  WX2 = (WEATHER % 80);
                  WX_ELEM2 = getWeatherCode(WX2)+',';
                  WX_ELEM3 = '';
                } else {
                  WX1 = Math.floor (WEATHER / 6400);
                  WX_ELEM1 = getWeatherCode(WX1);

                  WX2 = (WEATHER -(6400 * WX1));
                  WX2 = Math.floor(WX2/80);
                  WX_ELEM2 = getWeatherCode(WX2)+',';

                  WX3 = (WEATHER % 80);
                  WX_ELEM3 = getWeatherCode(WX3)+',';
                  //console.log(WEATHER,WX3,WX_ELEM3,WX2,WX_ELEM2,WX1,WX_ELEM1); 
                } 
                WEATHER = '<td>'+WX_ELEM3+' '+WX_ELEM2+' '+WX_ELEM1+'</td>';
              } else {
                if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('weather_condition_set_1d')) {
                  WEATHER = '<td>'+(DATA.STATION[0].OBSERVATIONS.weather_condition_set_1d[j])+'</td>';
                } else {
                  WEATHER = '<td>&nbsp;</td>';
                }
              }
            } else {
              var WEATHER = '<td>&nbsp;</td>';
            }
          } else {
            var WEATHER = '';
          }
          //Cloud Layers
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('cloud_layer_1_code_set_1')) {
            if (j == 0) {
              EngHeader += '<th>Clouds<br>&nbsp;<br>(x100 ft)</th>';
              MetHeader += '<th>Clouds<br>&nbsp;<br>(x100 ft)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.cloud_layer_1_code_set_1[j] !== null) {
              var SKY1 =(DATA.STATION[0].OBSERVATIONS.cloud_layer_1_code_set_1[j]).toString();
              var COVERAGE1 = SKY1.substr(SKY1.length -1);
              if (COVERAGE1 == "1") {
                SKY_COND1 = 'CLR';
              } else if (COVERAGE1 == "2") {
                SKY_COND1 = 'SCT';
              } else if (COVERAGE1 == "3") {
                SKY_COND1 = 'BKN';
              } else if (COVERAGE1 == "4") {
                SKY_COND1 = 'OVC';
              } else if (COVERAGE1 == "5") {
                SKY_COND1 = 'VV';
              } else if (COVERAGE1 == "6") {
                SKY_COND1 = 'FEW';
              } else {
                SKY_COND1 = '';
              }
              var DECK1 = parseInt(SKY1.slice(0, -1));
              if (isNaN(DECK1)) {
                DECK1 = '';
              } else if (DECK1 < 10) {
                DECK1 = "00"+DECK1;
              } else if (DECK1 < 100) {
                DECK1 = "0"+DECK1;
              } else {
                DECK1 = DECK1;
              }
            } else {
              var SKY_COND1 = '';
              var DECK1 = '';
            }
          } else {
            var SKY_COND1 = '';
            var DECK1 = '';
          }
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('cloud_layer_2_code_set_1')) {
            if (DATA.STATION[0].OBSERVATIONS.cloud_layer_2_code_set_1[j] !== null) {
              var SKY2 =(DATA.STATION[0].OBSERVATIONS.cloud_layer_2_code_set_1[j]).toString();
              var COVERAGE2 = SKY2.substr(SKY2.length -1);
              if (COVERAGE2 == "1") {
                SKY_COND2 = 'CLR';
              } else if (COVERAGE2 == "2") {
                SKY_COND2 = 'SCT';
              } else if (COVERAGE2 == "3") {
                SKY_COND2 = 'BKN';
              } else if (COVERAGE2 == "4") {
                SKY_COND2 = 'OVC';
              } else if (COVERAGE2 == "5") {
                SKY_COND2 = 'VV';
              } else if (COVERAGE2 == "6") {
                SKY_COND2 = 'FEW';
              } else {
                SKY_COND2 = '';
              }
              var DECK2 = parseInt(SKY2.slice(0, -1));
              if (isNaN(DECK2)) {
                DECK2 = '';
              } else if (DECK2 < 10) {
                DECK2 = "00"+DECK2;
              } else if (DECK2 < 100) {
                DECK2 = "0"+DECK2;
              } else {
                DECK2 = DECK2;
              }
            } else {
              var SKY_COND2 = '';
              var DECK2 = '';
            }
          } else {
            var SKY_COND2 = '';
            var DECK2 = '';
          }
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('cloud_layer_3_code_set_1')) {
            if (DATA.STATION[0].OBSERVATIONS.cloud_layer_3_code_set_1[j] !== null) {
              var SKY3 =(DATA.STATION[0].OBSERVATIONS.cloud_layer_3_code_set_1[j]).toString();
              var COVERAGE3 = SKY3.substr(SKY3.length -1);
              if (COVERAGE3 == "1") {
                SKY_COND3 = 'CLR';
              } else if (COVERAGE3 == "2") {
                SKY_COND3 = 'SCT';
              } else if (COVERAGE3 == "3") {
                SKY_COND3 = 'BKN';
              } else if (COVERAGE3 == "4") {
                SKY_COND3 = 'OVC';
              } else if (COVERAGE3 == "5") {
                SKY_COND3 = 'VV';
              } else if (COVERAGE3 == "6") {
                SKY_COND3 = 'FEW';
              } else {
                SKY_COND3 = '';
              }
              var DECK3 = parseInt(SKY3.slice(0, -1));
              if (isNaN(DECK3)) {
                DECK3 = '';
              } else if (DECK3 < 10) {
                DECK3 = "00"+DECK3;
              } else if (DECK3 < 100) {
                DECK3 = "0"+DECK3;
              } else {
                DECK3 = DECK3;
              }
            } else {
              var SKY_COND3 = '';
              var DECK3 = '';
            }
          } else {
            var SKY_COND3 = '';
            var DECK3 = '';
          }
          var SKY_COND = ''; 
          // If there was a cloud layer, THEN make the cloud cells
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('cloud_layer_1_code_set_1')) {
            if (SKY_COND1 == "CLR" || SKY_COND1 == "FEW" || SKY_COND1 == "SCT") {
              LAYER1 = SKY_COND1+DECK1;
            } else if (DECK1 < 10) {
              LAYER1 = '<font color=#FF00FF>'+SKY_COND1+DECK1+'</font>';
            } else if (DECK1 < 31) {
              LAYER1 = '<font color="red">'+SKY_COND1+DECK1+'</font>';
            } else if (DECK1 < 81) {
              LAYER1 = '<font color="orange">'+SKY_COND1+DECK1+'</font>';
            } else {
              LAYER1 = SKY_COND1+DECK1;
            }
  
            if (SKY_COND2 == "CLR" || SKY_COND2 == "FEW" || SKY_COND2 == "SCT") {
              LAYER2 = SKY_COND2+DECK2;
            } else if (DECK2 < 10) {
              LAYER2 = '<font color=#FF00FF>'+SKY_COND2+DECK2+'</font>';
            } else if (DECK2 < 31) {
              LAYER2 = '<font color="red">'+SKY_COND2+DECK2+'</font>';
            } else if (DECK2 < 81) {
              LAYER2 = '<font color="orange">'+SKY_COND2+DECK2+'</font>';
            } else {
              LAYER2 = SKY_COND2+DECK2;
            }
            if (SKY_COND3 == "CLR" || SKY_COND3 == "FEW" || SKY_COND3 == "SCT") {
              LAYER3 = SKY_COND3+DECK3;
            } else if (DECK3 < 10) {
              LAYER3 = '<font color=#FF00FF>'+SKY_COND3+DECK3+'</font>';
            } else if (DECK3 < 31) {
              LAYER3 = '<font color="red">'+SKY_COND3+DECK3+'</font>';
            } else if (DECK3 < 81) {
              LAYER3 = '<font color="orange">'+SKY_COND3+DECK3+'</font>';
            } else {
              LAYER3 = SKY_COND3+DECK3;
            }
            var SKY_COND = '<td>'+LAYER1+' '+LAYER2+' '+LAYER3+'</td>';
          }
          // Sea Level Pressure
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('sea_level_pressure_set_1')) {
            if (j == 0) {
                plot_menu("slp","Sea Level Pressure");
              EngHeader += '<th id="slp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\',\'Sea Level Pressure\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Sea Level<br>Pressure<br>(mb)</th>';
              MetHeader += '<th id="slp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\',\'Sea Level Pressure\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Sea Level<br>Pressure<br>(mb)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1[j] !== null) {
              if (units == 'metric') {
                var SEALEVEL = '<td>'+((DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1[j])/100).toFixed(2)+'</td>';
              } else {
                var SEALEVEL = '<td>'+(DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1[j]).toFixed(2)+'</td>';
              }
            } else {
              var SEALEVEL = '<td>&nbsp;</td>';
            }
          } else if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('sea_level_pressure_set_1d')) {
            if (j == 0) {
                plot_menu("slp","Sea Level Pressure");
              EngHeader += '<th id="slp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1d+'\',\'Sea Level Pressure\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1d+'\')">Sea Level<br>Pressure<br>(mb)</th>';
              MetHeader += '<th id="slp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1d+'\',\'Sea Level Pressure\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1d+'\')">Sea Level<br>Pressure<br>(mb)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1d[j] !== null) {
              if (units == 'metric') {
                var SEALEVEL = '<td>'+((DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1d[j])/100).toFixed(2)+'</td>';
              } else {
                var SEALEVEL = '<td>'+(DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1d[j]).toFixed(2)+'</td>';
              }
            } else {
              var SEALEVEL = '<td>&nbsp;</td>';
            }
          } else {
            var SEALEVEL = '';
          }
          // Station Pressure
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('pressure_set_1')) {
            has_pressure = 1;
            if (j == 0) {
                plot_menu("stn_press","Station Pressure");
              EngHeader += '<th id="stn_press" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.pressure_set_1+'\',\'Station Pressure\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Station<br>Pressure<br>(in Hg)</th>';
              MetHeader += '<th id="stn_press" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.pressure_set_1+'\',\'Station Pressure\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Station<br>Pressure<br>(mb)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.pressure_set_1[j] !== null) {
              if (units == 'metric') {  
                var P = '<td>'+((DATA.STATION[0].OBSERVATIONS.pressure_set_1[j])/100).toFixed(2)+'</td>';
              } else {
                if ((DATA.STATION[0].OBSERVATIONS.pressure_set_1[j]).toFixed(2) < 50) {
                  var P = '<td>'+(DATA.STATION[0].OBSERVATIONS.pressure_set_1[j]).toFixed(2)+'</td>';
                } else {
                  var P = '<td>'+((DATA.STATION[0].OBSERVATIONS.pressure_set_1[j])/33.684).toFixed(2)+'</td>';
                }
              }
            } else {
              var P = '<td>&nbsp;</td>';
            }
          } else {
            var P = '';
          }
          // Altimeter Setting
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('altimeter_set_1')) {
            if (j == 0) {
              if (has_pressure == 0) {
                EngHeader += '<th>Station<br>Pressure<br>(in Hg)</th>';  
                MetHeader += '<th>Station<br>Pressure<br>(mb)</th>';  
              }
                plot_menu("alstg","Altimeter Setting");
              EngHeader += '<th id="alstg" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.altimeter_set_1+'\',\'Altimeter Setting\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Altimeter<br>Setting<br>(in Hg)</th>';
              MetHeader += '<th id="alstg" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.altimeter_set_1+'\',\'Altimeter Setting\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Altimeter<br>Setting<br>(mb)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.altimeter_set_1[j] !== null) {
              var stationP = calcStationP(DATA.STATION[0].OBSERVATIONS.altimeter_set_1[j],stnELE);
              if (units == 'metric') {  
                if (has_pressure == 0) {
                  var ALTIMTER = '<td>'+(stationP/100).toFixed(2)+'</td><td>'+((DATA.STATION[0].OBSERVATIONS.altimeter_set_1[j])/100).toFixed(2)+'</td>';
                } else {
                  var ALTIMTER = '<td>'+((DATA.STATION[0].OBSERVATIONS.altimeter_set_1[j])/100).toFixed(2)+'</td>';
                }
              } else {
                if (has_pressure == 0) {
                  var ALTIMTER = '<td>'+stationP+'</td><td>'+(DATA.STATION[0].OBSERVATIONS.altimeter_set_1[j]).toFixed(2)+'</td>';
                } else {
                  var ALTIMTER = '<td>'+(DATA.STATION[0].OBSERVATIONS.altimeter_set_1[j]).toFixed(2)+'</td>';
                }
              }
            } else {
              if (has_pressure == 0) {
                var ALTIMTER = '<td>&nbsp;</td><td>&nbsp;</td>';
              } else {
                var ALTIMTER = '<td>&nbsp;</td>';
              }
            }
          } else {
            var ALTIMTER = '';
          }
          // Station Pressure
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('station_pressure_set_1')) {
            if (j == 0) {
                plot_menu("stn_press_2","Station Pressure");
              EngHeader += '<th id="stn_press_2" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.station_pressure_set_1+'\',\'Station Pressure\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Station<br>Pressure<br>(in Hg)</th>';
              MetHeader += '<th id="stn_press_2" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.station_pressure_set_1+'\',\'Station Pressure\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">Station<br>Pressure<br>(mb)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.station_pressure_set_1[j] !== null) {
              if (units == 'metric') {  
                var STATION_P = '<td>'+((DATA.STATION[0].OBSERVATIONS.station_pressure_set_1[j])/100).toFixed(2)+'</td>';
              } else {
                var STATION_P = '<td>'+(DATA.STATION[0].OBSERVATIONS.station_pressure_set_1[j]).toFixed(2)+'</td>';
              }
            } else {
              var STATION_P = '<td>&nbsp;</td>';
            }
          } else {
            var STATION_P = '';
          }
          // Solar Radiation 
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('solar_radiation_set_1')) {
            if (j == 0) {
                plot_menu("solar_rad","Solar Radiation");
              EngHeader += '<th id="solar_rad" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.solar_radiation_set_1+'\',\'Solar Radiation\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Solar<br>Radiation<br>(W/m&sup2;)</th><th>Percent<br>Possible<br>(%)</th>';
              MetHeader += '<th id="solar_rad" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.solar_radiation_set_1+'\',\'Solar Radiation\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Solar<br>Radiation<br>(W/m&sup2;)</th><th>Percent<br>Possible<br>(%)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.solar_radiation_set_1[j] !== null) {
              var RAW_SOLAR = (Math.round(DATA.STATION[0].OBSERVATIONS.solar_radiation_set_1[j]));
              var SOLAR_POSS = calcSolarPCT(MW_TIMESTAMP,stnLAT,stnLON);
              var PCT = Math.round (100 * RAW_SOLAR / SOLAR_POSS);
              if (PCT > 100) {
                PCT = 100;
              }
              if (RAW_SOLAR > 0 && SOLAR_POSS > 0) {
                var SOLAR     = '<td>'+RAW_SOLAR+'</td>';    
                var SOLAR_PCT = '<td>'+PCT+' %</td>';
              } else {
                var SOLAR     = '<td>0</td>';    
                var SOLAR_PCT = '<td>--</td>';
              }
            } else {
              var SOLAR = '<td>&nbsp;</td>';
              var SOLAR_PCT = '<td>&nbsp;</td>';
            }
          } else {
            var SOLAR = '';
            var SOLAR_PCT = '';
          }
          // Surface Temperature
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('surface_temp_set_1')) {
            if (j == 0) {
                plot_menu("surface_temp","Surface Temperature");
              EngHeader += '<th id="surface_temp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.surface_temp_set_1+'\',\'Surface Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Surface<br>Temp.<br>(&deg;F)</th>';
              MetHeader += '<th id="surface_temp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.surface_temp_set_1+'\',\'Surface Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Surface<br>Temp.<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.surface_temp_set_1[j] !== null) {
              var SURF_T = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.surface_temp_set_1[j])+'</td>';
            } else {
              var SURF_T = '<td>&nbsp;</td>';
            }
          } else {
            var SURF_T = '';
          }
          // Soil Temperature
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('soil_temp_set_1')) {
            if (j == 0) {
                plot_menu("soil_temp","Soil Temperature");
              EngHeader += '<th id="soil_temp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.soil_temp_set_1+'\',\'Soil Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Soil<br>Temp.<br>(&deg;F)</th>';
              MetHeader += '<th id="soil_temp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.soil_temp_set_1+'\',\'Soil Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Soil<br>Temp.<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.soil_temp_set_1[j] !== null) {
              var SOIL_T = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.soil_temp_set_1[j])+'</td>';
            } else {
              var SOIL_T = '<td>&nbsp;</td>';
            }
          } else {
            var SOIL_T = '';
          }
          // Road Temperature
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('road_temp_set_1')) {
            if (j == 0) {
                plot_menu("road_temp","Road Temperature");
              EngHeader += '<th id="road_temp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.road_temp_set_1+'\',\'Road Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Road<br>Temp.<br>(&deg;F)</th>';
              MetHeader += '<th id="road_temp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.road_temp_set_1+'\',\'Road Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Road<br>Temp.<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.road_temp_set_1[j] !== null) {
              var ROAD_T = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.road_temp_set_1[j])+'</td>';
            } else {
              var ROAD_T = '<td>&nbsp;</td>';
            }
          } else if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('road_temp_set_2')) {
            if (j == 0) {
                plot_menu("road_temp_2","Road Temperature");
              EngHeader += '<th id="road_temp_2" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.road_temp_set_2+'\',\'Road Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Road<br>Temp.<br>(&deg;F)</th>';
              MetHeader += '<th id="road_temp_2" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.road_temp_set_2+'\',\'Road Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Road<br>Temp.<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.road_temp_set_2[j] !== null) {
              var ROAD_T = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.road_temp_set_2[j])+'</td>';
            } else {
              var ROAD_T = '<td>&nbsp;</td>';
            }
          } else {
            var ROAD_T = '';
          }
          // Road Sub-Surface Temp 
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('road_subsurface_tmp_set_1')) {
            if (j == 0) {
                plot_menu("road_sub_temp","Road Sub-Surface Temp");
              EngHeader += '<th id="road_sub_temp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.road_temp_set_2+'\',\'Road Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Road<br>Temp.<br>(&deg;F)</th>';
              MetHeader += '<th id="road_sub_temp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.road_temp_set_2+'\',\'Road Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Road<br>Temp.<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.road_subsurface_tmp_set_1[j] !== null) {
              var SROAD_T = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.road_subsurface_tmp_set_1[j])+'</td>';
            } else {
              var SROAD_T = '<td>&nbsp;</td>';
            }
          } else {
            var SROAD_T = '';
          }
          // If Accumulated Precip or any increment of precip up to one hour is set, 
          // we will calculate 1, 3, 6 and 24 hour precip values on our own.  
          // Synoptic does not consistently return ihigher interval data for those fields 
          // Even if we get those fields, we will disable any processing of that data down the line.
           
          // Accumulated Precip
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('precip_accum_set_1')) {
            derived = 1;
            accum_true = 1; 
            has_precip = 1;
	    if (j == 0) {
              plot_menu("accum_pcpn","Accumulated Precip");
              if (pview == 'measured') {
                EngHeader += '<th id="accum_pcpn" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_set_1+'\',\'Accumulated Precipitation\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\');">Accumulated<br>Precip<br>(in)</th>';
                MetHeader += '<th id="accum_pcpn" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_set_1+'\',\'Accumulated Precipitation\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\');">Accumulated<br>Precip<br>(mm)</th>';
              } else {
                EngHeader += '<th id="accum_pcpn" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_set_1+'\',\'Accumulated Precipitation\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\');">Accumulated<br>Precip<br>(in)</th><th title="This data is derived by taking\n the the accumulated value at the\n time listed and subtracting the\n accumulated value 1 hour prior.">1 Hour<br>Precip<br>(in)</th><th title="This data is derived by taking\n the the accumulated value at the\n time listed and subtracting the\n accumulated value 3 hours prior.">3 Hour<br>Precip<br>(in)</th><th title="This data is derived by taking\n the the accumulated value at the\n time listed and subtracting the\n accumulated value 6 hours prior.">6 Hour<br>Precip<br>(in)</th><th title="This data is derived by taking\n the the accumulated value at the\n time listed and subtracting the\n accumulated value 24 hours prior.">24 Hour<br>Precip<br>(in)</th>';
                MetHeader += '<th id="accum_pcpn" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_set_1+'\',\'Accumulated Precipitation\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\');">Accumulated<br>Precip<br>(mm)</th><th title="This data is derived by taking\n the the accumulated value at the\n time listed and subtracting the\n accumulated value 1 hour prior.">1 Hour<br>Precip<br>(mm)</th><th title="This data is derived by taking\n the the accumulated value at the\n time listed and subtracting the\n accumulated value 3 hours prior.">3 Hour<br>Precip<br>(mm)</th><th title="This data is derived by taking\n the the accumulated value at the\n time listed and subtracting the\n accumulated value 6 hours prior.">6 Hour<br>Precip<br>(mm)</th><th title="This data is derived by taking\n the the accumulated value at the\n time listed and subtracting the\n accumulated value 24 hours prior.">24 Hour<br>Precip<br>(mm)</th>';
              }
            }
            if (DATA.STATION[0].OBSERVATIONS.precip_accum_set_1[j] !== null) {
              var ACC_Precip = (DATA.STATION[0].OBSERVATIONS.precip_accum_set_1[j]).toFixed(2);
              var oneHRprecip   = '';
              var threeHRprecip = '';
              var sixHRprecip   = '';
              var oneDAYprecip  = '';
              if (pview == 'measured') {
                oneHRprecip   = '';
                threeHRprecip = '';
                sixHRprecip   = '';
                oneDAYprecip  = '';
                var ACC_PCPN = '<td><font color="green">'+ACC_Precip+'</font></td>';
              } else if (pview == 'full') {
                oneHRprecip   = getDerivedPrecip(60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_set_1);
                threeHRprecip = getDerivedPrecip(180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_set_1);
                sixHRprecip   = getDerivedPrecip(360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_set_1);
                oneDAYprecip  = getDerivedPrecip(1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_set_1);
                var ACC_PCPN = '<td><font color="green">'+ACC_Precip+'</font></td><td><font color="green">'+oneHRprecip+'</font></td><td><font color="green">'+threeHRprecip+'</font></td><td><font color="green">'+sixHRprecip+'</font></td><td><font color="green">'+oneDAYprecip+'</font></td>';
              } else if (numHours > numObs) {
                oneHRprecip   = getDerivedPrecip(60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_set_1);
                if (hours % 3 === 0 || j == numObs) {
                  threeHRprecip = getDerivedPrecip(180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_set_1);
                }
                if (hours % 6 === 0 || j == numObs) {
                  sixHRprecip   = getDerivedPrecip(360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_set_1);
                }
                if (hours % 12 === 0 || j == numObs) {
                  oneDAYprecip  = getDerivedPrecip(1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_set_1);
                }
                var ACC_PCPN = '<td><font color="green">'+ACC_Precip+'</font></td><td><font color="green">'+oneHRprecip+'</font></td><td><font color="green">'+threeHRprecip+'</font></td><td><font color="green">'+sixHRprecip+'</font></td><td><font color="green">'+oneDAYprecip+'</font></td>';
              } else {
                if (minutes == '00' || j == numObs) {
                  oneHRprecip   = getDerivedPrecip(60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_set_1);
                  if (hours % 3 === 0 || j == numObs) {
                    threeHRprecip = getDerivedPrecip(180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_set_1);
                  }
                  if (hours % 6 === 0 || j == numObs) {
                    sixHRprecip   = getDerivedPrecip(360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_set_1);
                  }
                  if (hours % 12 === 0 || j == numObs) {
                    oneDAYprecip  = getDerivedPrecip(1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_set_1);
                  }
                }
                var ACC_PCPN = '<td><font color="green">'+ACC_Precip+'</font></td><td><font color="green">'+oneHRprecip+'</font></td><td><font color="green">'+threeHRprecip+'</font></td><td><font color="green">'+sixHRprecip+'</font></td><td><font color="green">'+oneDAYprecip+'</font></td>';
              }
            } else {
              if (pview == 'measured') {
                var ACC_PCPN = '<td>&nbsp;</td>';
              } else {
                var ACC_PCPN = '<td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>';
              }
            }
          } else {
            var ACC_PCPN = '';
          }
          // If we have accumulated precip, there is no need for any of these.
          if (accum_true == 0) {
            // 1 Minute Precip
            if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('precip_accum_one_minute_set_1')) {
              derived = 1;
              has_precip = 1;
              if (j == 0) {
                plot_menu("one_min_pcpn","1 Minute Precip");
                if (pview == 'measured') {
                  EngHeader += '<th id="one_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1+'\',\'One Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">1 Min.</br>Precip<br>(in)</th>';
                  MetHeader += '<th id="one_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1+'\',\'One Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">1 Min.</br>Precip<br>(mm)</th>';
                } else {
                  EngHeader += '<th id="one_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1+'\',\'One Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">1 Min.</br>Precip<br>(in)</th><th>1 Hour</br>Precip<br>(in)</th><th>3 Hour</br>Precip<br>(in)</th><th>6 Hour</br>Precip<br>(in)</th><th>24 Hour</br>Precip<br>(in)</th>';
                  MetHeader += '<th id="one_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1+'\',\'One Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">1 Min.</br>Precip<br>(mm)</th><th>1 Hour</br>Precip<br>(mm)</th><th>3 Hour</br>Precip<br>(mm)</th><th>6 Hour</br>Precip<br>(mm)</th><th>24 Hour</br>Precip<br>(mm)</th>';
                }
              }
              if (DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1[j] !== null) {
                var oneMINprecip = (DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1[j]).toFixed(2);
                if (oneMINprecip == '0.001' || oneMINprecip == '0.005') {
                   oneMINprecip = 'T';
                }
                var oneHRprecip   = '';
                var threeHRprecip = '';
                var sixHRprecip   = '';
                var oneDAYprecip  = ''; 
                if (pview == 'measured') {
                  var MIN_1_PCPN = '<td><font color="green">'+oneMINprecip+'</font></td>';
                } else if (pview == 'full') {
                  oneHRprecip   = calcIncrementalPrecip (60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1);
                  threeHRprecip = calcIncrementalPrecip (180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1);
                  sixHRprecip   = calcIncrementalPrecip (360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1);
                  oneDAYprecip  = calcIncrementalPrecip (1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1); 
                  var MIN_1_PCPN = '<td><font color="green">'+oneMINprecip+'</font></td><td><font color="green">'+oneHRprecip+'</td><td><font color="green">'+threeHRprecip+'</td><td><font color="green">'+sixHRprecip+'</td><td><font color="green">'+oneDAYprecip+'</td>';
                } else if (minutes == '00' || j == numObs) {
                  oneHRprecip   = calcIncrementalPrecip (60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1);
                  if (hours % 3 === 0 || j == numObs) {
                    threeHRprecip = calcIncrementalPrecip (180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1);
                  } else {
                    threeHRprecip = '';
                  }
                  if (hours % 6 === 0 || j == numObs) {
                    sixHRprecip   = calcIncrementalPrecip (360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1);
                  } else {
                    sixHRprecip = '';
                  }
                  if (hours % 12 === 0 || j == numObs) {
                    oneDAYprecip  = calcIncrementalPrecip (1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_one_minute_set_1);
                  } else {
                    oneDAYprecip = '';
                  }
                  var MIN_1_PCPN = '<td><font color="green">'+oneMINprecip+'</font></td><td><font color="green">'+oneHRprecip+'</td><td><font color="green">'+threeHRprecip+'</td><td><font color="green">'+sixHRprecip+'</td><td><font color="green">'+oneDAYprecip+'</td>';
                } else {
                  var MIN_1_PCPN = '<td><font color="green">'+oneMINprecip+'</font></td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>';
                }
              } else {
                if (pview == 'measured') {
                  var MIN_1_PCPN = '<td>&nbsp;</td>';
                } else {
                  var MIN_1_PCPN = '<td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>';
                }
              }
            } else {
              var MIN_1_PCPN = '';
            }  
            // 5 Minute Precip
            if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('precip_accum_five_minute_set_1')) {
              derived = 1;
              has_precip = 1;
              if (j == 0) {
                plot_menu("five_min_pcpn","5 Minute Precip");
                if (pview == 'measured') {
                  EngHeader += '<th id="five_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1+'\',\'Five Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">5 Min.</br>Precip<br>(in)</th>';
                  MetHeader += '<th id="five_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1+'\',\'Five Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">5 Min.</br>Precip<br>(mm)</th>';
                } else {
                  EngHeader += '<th id="five_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1+'\',\'Five Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">5 Min.</br>Precip<br>(in)</th><th>1 Hour</br>Precip<br>(in)</th><th>3 Hour</br>Precip<br>(in)</th><th>6 Hour</br>Precip<br>(in)</th><th>24 Hour</br>Precip<br>(in)</th>';
                  MetHeader += '<th id="five_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1+'\',\'Five Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">5 Min.</br>Precip<br>(mm)</th><th>1 Hour</br>Precip<br>(mm)</th><th>3 Hour</br>Precip<br>(mm)</th><th>6 Hour</br>Precip<br>(mm)</th><th>24 Hour</br>Precip<br>(mm)</th>';
                }
              }
              if (DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1[j] !== null) {
                var fiveMINprecip = (DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1[j]).toFixed(2);
                if (fiveMINprecip == '0.001' || fiveMINprecip == '0.005') {
                   fiveMINprecip = 'T';
                }
                var oneHRprecip   = '';
                var threeHRprecip = '';
                var sixHRprecip   = '';
                var oneDAYprecip  = ''; 
                if (pview == 'measured') {
                  var MIN_5_PCPN = '<td><font color="green">'+fiveMINprecip+'</font></td>';
                } else if (pview == 'full') {
                  oneHRprecip   = calcIncrementalPrecip (60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1);
                  threeHRprecip = calcIncrementalPrecip (180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1);
                  sixHRprecip   = calcIncrementalPrecip (360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1);
                  oneDAYprecip  = calcIncrementalPrecip (1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1);
                  var MIN_5_PCPN = '<td><font color="green">'+fiveMINprecip+'</font></td><td><font color="green">'+oneHRprecip+'</td><td><font color="green">'+threeHRprecip+'</td><td><font color="green">'+sixHRprecip+'</td><td><font color="green">'+oneDAYprecip+'</td>';
                } else if (minutes == '00' || j == numObs) {
                  oneHRprecip   = calcIncrementalPrecip (60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1);
                  if (hours % 3 === 0 || j == numObs) {
                    threeHRprecip = calcIncrementalPrecip (180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1);
                  } else {
                    threeHRprecip = '';
                  }
                  if (hours % 6 === 0 || j == numObs) {
                    sixHRprecip   = calcIncrementalPrecip (360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1);
                  } else {
                    sixHRprecip = '';
                  }
                  if (hours % 12 === 0 || j == numObs) {
                    oneDAYprecip  = calcIncrementalPrecip (1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_five_minute_set_1);
                  } else {
                    oneDAYprecip = '';
                  }
                  var MIN_5_PCPN = '<td><font color="green">'+fiveMINprecip+'</font></td><td><font color="green">'+oneHRprecip+'</td><td><font color="green">'+threeHRprecip+'</td><td><font color="green">'+sixHRprecip+'</td><td><font color="green">'+oneDAYprecip+'</td>';
                } else {
                  var MIN_5_PCPN = '<td><font color="green">'+fiveMINprecip+'</font></td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>';
                }
              } else {
                if (pview == 'measured') {
                  var MIN_5_PCPN = '<td>&nbsp;</td>';
                } else {
                  var MIN_5_PCPN = '<td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>';
                }
              }
            } else {
              var MIN_5_PCPN = '';
            }
            // 10 Minute Precip
            if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('precip_accum_ten_minute_set_1')) {
              derived = 1;
              has_precip = 1;
              if (j == 0) {
                plot_menu("ten_min_pcpn","10 Minute Precip");
                if (pview == 'measured') {
                  EngHeader += '<th id="ten_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1+'\',\'Ten Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">10 Min.</br>Precip<br>(in)</th>';
                  MetHeader += '<th id="ten_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1+'\',\'Ten Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">10 Min.</br>Precip<br>(mm)</th>';
                } else { 
                  EngHeader += '<th id="ten_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1+'\',\'Ten Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">10 Min.</br>Precip<br>(in)</th><th>1 Hour</br>Precip<br>(in)</th><th>3 Hour</br>Precip<br>(in)</th><th>6 Hour</br>Precip<br>(in)</th><th>24 Hour</br>Precip<br>(in)</th>';
                  MetHeader += '<th id="ten_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1+'\',\'Ten Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">10 Min.</br>Precip<br>(mm)</th><th>1 Hour</br>Precip<br>(mm)</th><th>3 Hour</br>Precip<br>(mm)</th><th>6 Hour</br>Precip<br>(mm)</th><th>24 Hour</br>Precip<br>(mm)</th>';
                }
              }
              if (DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1[j] !== null) {
                var tenMINprecip = (DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1[j]).toFixed(2);
                var oneHRprecip   = '';
                var threeHRprecip = '';
                var sixHRprecip   = '';
                var oneDAYprecip  = '';
                if (pview == 'measured') {
                  var MIN_10_PCPN = '<td><font color="green">'+tenMINprecip+'</font></td>';
                } else if (pview == 'full') {
                  oneHRprecip   = calcIncrementalPrecip (60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1);
                  threeHRprecip = calcIncrementalPrecip (180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1);
                  sixHRprecip   = calcIncrementalPrecip (360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1);
                  oneDAYprecip  = calcIncrementalPrecip (1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1);
                  var MIN_10_PCPN = '<td><font color="green">'+tenMINprecip+'</font></td><td><font color="green">'+oneHRprecip+'</td><td><font color="green">'+threeHRprecip+'</td><td><font color="green">'+sixHRprecip+'</td><td><font color="green">'+oneDAYprecip+'</td>';
                } else if (minutes == '00' || j == numObs) {
                  oneHRprecip   = calcIncrementalPrecip (60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1);
                  if (hours % 3 === 0 || j == numObs) {
                    threeHRprecip = calcIncrementalPrecip (180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1);
                  } else {
                    threeHRprecip = '';
                  }
                  if (hours % 6 === 0 || j == numObs) {
                    sixHRprecip   = calcIncrementalPrecip (360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1);
                  } else {
                    sixHRprecip = '';
                  }
                  if (hours % 12 === 0 || j == numObs) {
                    oneDAYprecip  = calcIncrementalPrecip (1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_ten_minute_set_1);
                  } else {
                    oneDAYprecip = '';
                  }
                  var MIN_10_PCPN = '<td><font color="green">'+tenMINprecip+'</font></td><td><font color="green">'+oneHRprecip+'</td><td><font color="green">'+threeHRprecip+'</td><td><font color="green">'+sixHRprecip+'</td><td><font color="green">'+oneDAYprecip+'</td>';
                } else {
                  var MIN_10_PCPN = '<td><font color="green">'+tenMINprecip+'</font></td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>';
                }
              } else {
                if (pview == 'measured') {
                  var MIN_10_PCPN = '<td>&nbsp;</td>';
                } else {
                  var MIN_10_PCPN = '<td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>';
                }
              }
            } else {
              var MIN_10_PCPN = '';
            }
            // 15 Minute Precip
            if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('precip_accum_fifteen_minute_set_1')) {
              derived = 1;
              has_precip = 1;
              if (j == 0) {
                plot_menu("fifteen_min_pcpn","15 Minute Precip");
                if (pview == 'measured') {
                  EngHeader += '<th id="fifteen_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1+'\',\'Fifteen Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">15 Min.</br>Precip<br>(in)</th>';
                  MetHeader += '<th id="fifteen_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1+'\',\'Fifteen Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">15 Min.</br>Precip<br>(mm)</th>';
                } else {
                  EngHeader += '<th id="fifteen_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1+'\',\'Fifteen Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">15 Min.</br>Precip<br>(in)</th><th>1 Hour</br>Precip<br>(in)</th><th>3 Hour</br>Precip<br>(in)</th><th>6 Hour</br>Precip<br>(in)</th><th>24 Hour</br>Precip<br>(in)</th>';
                  MetHeader += '<th id="fifteen_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1+'\',\'Fifteen Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">15 Min.</br>Precip<br>(mm)</th><th>1 Hour</br>Precip<br>(mm)</th><th>3 Hour</br>Precip<br>(mm)</th><th>6 Hour</br>Precip<br>(mm)</th><th>24 Hour</br>Precip<br>(mm)</th>';
                }
              }
              if (DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1[j] !== null) {
                var fifteenMINprecip = (DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1[j]).toFixed(2);
                var oneHRprecip   = '';
                var threeHRprecip = '';
                var sixHRprecip   = '';
                var oneDAYprecip  = '';
                if (pview == 'measured') {
                  var MIN_15_PCPN = '<td><font color="green">'+fifteenMINprecip+'</font></td>';
                } else if (pview == 'full') {
                  oneHRprecip   = calcIncrementalPrecip (60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1);
                  threeHRprecip = calcIncrementalPrecip (180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1);
                  sixHRprecip   = calcIncrementalPrecip (360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1);
                  oneDAYprecip  = calcIncrementalPrecip (1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1);
                  var MIN_15_PCPN = '<td><font color="green">'+fifteenMINprecip+'</font></td><td><font color="green">'+oneHRprecip+'</td><td><font color="green">'+threeHRprecip+'</td><td><font color="green">'+sixHRprecip+'</td><td><font color="green">'+oneDAYprecip+'</td>';
                } else if (minutes == '00' || j == numObs) {
                  oneHRprecip   = calcIncrementalPrecip (60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1);
                  if (hours % 3 === 0 || j == numObs) {
                    threeHRprecip = calcIncrementalPrecip (180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1);
                  } else { 
                    threeHRprecip = '';
                  }
                  if (hours % 6 === 0 || j == numObs) {
                    sixHRprecip   = calcIncrementalPrecip (360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1);
                  } else {
                    sixHRprecip = '';
                  }
                  if (hours % 12 === 0 || j == numObs) {
                    oneDAYprecip  = calcIncrementalPrecip (1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_fifteen_minute_set_1);
                  } else {
                    oneDAYprecip = '';  
                  }
                  var MIN_15_PCPN = '<td><font color="green">'+fifteenMINprecip+'</font></td><td><font color="green">'+oneHRprecip+'</td><td><font color="green">'+threeHRprecip+'</td><td><font color="green">'+sixHRprecip+'</td><td><font color="green">'+oneDAYprecip+'</td>';
                } else {
                  var MIN_15_PCPN = '<td><font color="green">'+fifteenMINprecip+'</font></td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>'; 
                } 
              } else {
                if (pview == 'measured') {
                  var MIN_15_PCPN = '<td>&nbsp;</td>';
                } else {
                  var MIN_15_PCPN = '<td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>';
                }
              }
            } else {
              var MIN_15_PCPN = '';
            }
            // 30 Minute Precip
            if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('precip_accum_30_minute_set_1')) {
              derived = 1;
              has_precip = 1;
              if (j == 0) {
                plot_menu("thirty_min_pcpn","30 Minute Precip");
                if (pview == 'measured') {
                  EngHeader += '<th id="thirty_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1+'\',\'Thirty Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">30 Min.</br>Precip<br>(in)</th>';
                  MetHeader += '<th id="thirty_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1+'\',\'Thirty Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">30 Min.</br>Precip<br>(mm)</th>';
                } else { 
                  EngHeader += '<th id="thirty_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1+'\',\'Thirty Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">30 Min.</br>Precip<br>(in)</th><th>1 Hour</br>Precip<br>(in)</th><th>3 Hour</br>Precip<br>(in)</th><th>6 Hour</br>Precip<br>(in)</th><th>24 Hour</br>Precip<br>(in)</th>';
                  MetHeader += '<th id="thirty_min_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1+'\',\'Thirty Minute Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">30 Min.</br>Precip<br>(mm)</th><th>1 Hour</br>Precip<br>(mm)</th><th>3 Hour</br>Precip<br>(mm)</th><th>6 Hour</br>Precip<br>(mm)</th><th>24 Hour</br>Precip<br>(mm)</th>';
                }
              }
              if (DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1[j] !== null) {
                var thirtyMINprecip = (DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1[j]).toFixed(2);
                var oneHRprecip   = '';
                var threeHRprecip = '';
                var sixHRprecip   = '';
                var oneDAYprecip  = '';
                if (pview == 'measured') {
                  var MIN_30_PCPN = '<td><font color="green">'+thirtyMINprecip+'</font></td>';
                } else if (pview == 'full') {
                  oneHRprecip   = calcIncrementalPrecip (60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1);
                  threeHRprecip = calcIncrementalPrecip (180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1);
                  sixHRprecip   = calcIncrementalPrecip (360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1);
                  oneDAYprecip  = calcIncrementalPrecip (1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1);
                  var MIN_30_PCPN = '<td><font color="green">'+thirtyMINprecip+'</font></td><td><font color="green">'+oneHRprecip+'</td><td><font color="green">'+threeHRprecip+'</td><td><font color="green">'+sixHRprecip+'</td><td><font color="green">'+oneDAYprecip+'</td>';
                } else if (minutes == '00' || j == numObs) {
                  var oneHRprecip   = calcIncrementalPrecip (60,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1);
                  if (hours % 3 === 0 || j == numObs) {
                    var threeHRprecip = calcIncrementalPrecip (180,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1);
                  } else {
                    var threeHRprecip = '';
                  }
                  if (hours % 6 === 0 || j == numObs) {
                    var sixHRprecip   = calcIncrementalPrecip (360,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1);
                  } else {
                    var sixHRprecip = '';
                  }
                  if (hours % 12 === 0 || j == numObs) {
                    var oneDAYprecip  = calcIncrementalPrecip (1440,j,stamps,DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1);
                  } else {
                    var oneDAYprecip = '';
                  }
                  var MIN_30_PCPN = '<td><font color="green">'+thirtyMINprecip+'</font></td><td><font color="green">'+oneHRprecip+'</td><td><font color="green">'+threeHRprecip+'</td><td><font color="green">'+sixHRprecip+'</td><td><font color="green">'+oneDAYprecip+'</td>';
                } else {
                  var MIN_30_PCPN = '<td><font color="green">'+(DATA.STATION[0].OBSERVATIONS.precip_accum_30_minute_set_1[j]).toFixed(2)+'</font></td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>';
                }
              } else {
                if (pview == 'measured') {
                  var MIN_30_PCPN = '<td>&nbsp;</td>';
                } else {
                  var MIN_30_PCPN = '<td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>';
                }
              }
            } else {
              var MIN_30_PCPN = '';
            }
          } else {
            var  MIN_1_PCPN = '';
            var  MIN_5_PCPN = '';
            var  MIN_10_PCPN = '';
            var  MIN_15_PCPN = '';
            var  MIN_30_PCPN = '';
          }
          // We have built out 1, 3, 6 and 24 hour precip data with the 1, 5, 10, 15, and 30 minute data
          // As such, if we did not get any 1, 5, 10, 15, or 30 minute data, test for 1, 3, 6, and 24 hout data
          if (derived == '0') {
            // 1 Hour Precip
            if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('precip_accum_one_hour_set_1')) {
              has_precip = 1;
              if (j == 0) {
                plot_menu("one_hour_pcpn","1 Hour Precip");
                EngHeader += '<th id="one_hour_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_one_hour_set_1+'\',\'One Hour Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">1 Hour<br>Precip<br>(in)</th>';
                MetHeader += '<th id="one_hour_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_one_hour_set_1+'\',\'One Hour Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">1 Hour<br>Precip<br>(mm)</th>';
              }
              if (DATA.STATION[0].OBSERVATIONS.precip_accum_one_hour_set_1[j] !== null) {
                if (parseFloat(DATA.STATION[0].OBSERVATIONS.precip_accum_one_hour_set_1[j]) == '0.001' || parseFloat(DATA.STATION[0].OBSERVATIONS.precip_accum_one_hour_set_1[j]) == '0.005') {
                  var HR_1_PCPN = '<td><font color="green">T</font></td>';
                } else { 
                  var HR_1_PCPN = '<td><font color="green">'+(DATA.STATION[0].OBSERVATIONS.precip_accum_one_hour_set_1[j]).toFixed(2)+'</font></td>';
                }
              } else {
                var HR_1_PCPN = '<td>&nbsp;</td>';
              }
            } else {
              var HR_1_PCPN = '';
            }
            // 3 Hour Precip
            if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('precip_accum_three_hour_set_1')) {
              has_precip = 1;
              if (j == 0) {
                plot_menu("three_hour_pcpn","3 Hour Precip");
                EngHeader += '<th id="three_hour_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_three_hour_set_1+'\',\'Three Hour Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">3 Hour</br>Precip<br>(in)</th>';
                MetHeader += '<th id="three_hour_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_three_hour_set_1+'\',\'Three Hour Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">3 Hour</br>Precip<br>(mm)</th>';
              }
              if (DATA.STATION[0].OBSERVATIONS.precip_accum_three_hour_set_1[j] !== null) {
                if (parseFloat(DATA.STATION[0].OBSERVATIONS.precip_accum_three_hour_set_1[j]) == '0.001' || parseFloat(DATA.STATION[0].OBSERVATIONS.precip_accum_three_hour_set_1[j]) == '0.005') {
                  var HR_3_PCPN = '<td><font color="green">T</font></td>';
                } else { 
                  var HR_3_PCPN = '<td><font color="green">'+(DATA.STATION[0].OBSERVATIONS.precip_accum_three_hour_set_1[j]).toFixed(2)+'</font></td>';
                }
              } else {
                var HR_3_PCPN = '<td>&nbsp;</td>';
              }
            } else {
              var HR_3_PCPN = '';
            }
            // 6 Hour Precip 
            if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('precip_accum_six_hour_set_1')) {
              has_precip = 1;
              if (j == 0) {
                plot_menu("six_hour_pcpn","6 Hour Precip");
                EngHeader += '<th id="six_hour_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_six_hour_set_1+'\',\'Six Hour Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">6 Hour<br>Precip<br>(in)</th>';
                MetHeader += '<th id="six_hour_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_six_hour_set_1+'\',\'Six Hour Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">6 Hour<br>Precip<br>(mm)</th>';
              }
              if (DATA.STATION[0].OBSERVATIONS.precip_accum_six_hour_set_1[j] !== null) {
                if (parseFloat(DATA.STATION[0].OBSERVATIONS.precip_accum_six_hour_set_1[j]) == '0.001' || parseFloat(DATA.STATION[0].OBSERVATIONS.precip_accum_six_hour_set_1[j]) == '0.005') {
                  var HR_6_PCPN = '<td><font color="green">T</font></td>';
                } else {
                  var HR_6_PCPN = '<td><font color="green">'+(DATA.STATION[0].OBSERVATIONS.precip_accum_six_hour_set_1[j]).toFixed(2)+'</font></td>';
                }
              } else {
              var HR_6_PCPN = '<td>&nbsp;</td>';
              }
            } else {
              var HR_6_PCPN = '';
            }
            // 24 Hour Precip
            if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('precip_accum_24_hour_set_1')) {
              has_precip = 1;
              if (j == 0) {
                plot_menu("twentyfour_hour_pcpn","24 Hour Precip");
                EngHeader += '<th id="twentyfour_hour_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_24_hour_set_1+'\',\'24 Hour Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">24 Hour<br>Precip<br>(in)</th>';
                MetHeader += '<th id="twentyfour_hour_pcpn" class="zoom" title="Click to view chart" onclick="makeBarChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_24_hour_set_1+'\',\'24 Hour Precipitation\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\',\''+DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1+'\')">24 Hour<br>Precip<br>(mm)</th>';

              }
              if (DATA.STATION[0].OBSERVATIONS.precip_accum_24_hour_set_1[j] !== null) {
                if (parseFloat(DATA.STATION[0].OBSERVATIONS.precip_accum_24_hour_set_1[j]) == '0.001' || parseFloat(DATA.STATION[0].OBSERVATIONS.precip_accum_24_hour_set_1[j]) == '0.005') {
                  var HR_24_PCPN = '<td><font color="green">T</font></td>';
                } else {
                  var HR_24_PCPN = '<td><font color="green">'+(DATA.STATION[0].OBSERVATIONS.precip_accum_24_hour_set_1[j]).toFixed(2)+'</font></td>';
                }
              } else {
                var HR_24_PCPN = '<td>&nbsp;</td>';
              }
            } else {
              var HR_24_PCPN = '';
            }
          } else {
            var HR_1_PCPN = ''; 
            var HR_3_PCPN = '';
            var HR_6_PCPN = '';
            var HR_24_PCPN = '';
          }   
          // Precip since Midnight 
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('precip_accum_since_local_midnight_set_1')) {
            has_precip = 1;
            if (j == 0) {
              plot_menu("sincemid_pcpn","Precip since Midnight");
              EngHeader += '<th id="sincemid_pcpn" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_since_local_midnight_set_1+'\',\'Precip since Midnight\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">Precip<br>Since 12am<br>(in)</th>';
              MetHeader += '<th id="sincemid_pcpn" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_accum_since_local_midnight_set_1+'\',\'Precip since Midnight\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">Precip<br>Since 12am<br>(mm)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.precip_accum_since_local_midnight_set_1[j] !== null) {
              var MIDNIGHT = '<td><font color="green">'+(DATA.STATION[0].OBSERVATIONS.precip_accum_since_local_midnight_set_1[j]).toFixed(2)+'</font></td>';
            } else {
              var MIDNIGHT = '<td>&nbsp;</td>';
            }
          } else {
            var MIDNIGHT = '';
          }
          // Precip since Midnight 
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('precip_interval_set_1')) {
            has_precip = 1;
            if (j == 0) {
              plot_menu("sincemid_pcpn","Precip Interval");
              EngHeader += '<th id="sincemid_pcpn" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_interval_set_1+'\',\'Precip Interval\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">Precip<br>Interval<br>(in)</th>';
              MetHeader += '<th id="sincemid_pcpn" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.precip_interval_set_1+'\',\'Precip Interval\',\''+units+'\',\''+TIMEZONE+'\',\''+SITE+'\',\''+network+'\')">Precip<br>Interval<br>(mm)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.precip_interval_set_1[j] !== null) {
              var PRECIPINT = '<td><font color="green">'+(DATA.STATION[0].OBSERVATIONS.precip_interval_set_1[j]).toFixed(2)+'</font></td>';
            } else {
              var PRECIPINT = '<td>&nbsp;</td>';
            }
          } else {
            var PRECIPINT = '';
          }
          // Snow Depth 
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('snow_depth_set_1')) {
            if (j == 0) {
              plot_menu("snow_depth","Snow Depth");
              if (pview == 'measured') {
                EngHeader += '<th id="snow_depth" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.snow_depth_set_1+'\',\'Snow Depth\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\');">Snow<br>Depth<br>(in)</th>';
                MetHeader += '<th id="snow_depth" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.snow_depth_set_1+'\',\'Snow Depth\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\');">Snow<br>Depth<br>(mm)</th>';
              } else {
                EngHeader += '<th id="snow_depth" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.snow_depth_set_1+'\',\'Snow Depth\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\');">Snow<br>Depth<br>(in)</th><th title="This data is derived by taking\n the the snow depth value at the\n time listed and subtracting the\n snow depth value 3 hours prior.">Snowfall<br>3 hour<br>(in)</th><th title="This data is derived by taking\n the the snow depth value at the\n time listed and subtracting the\n snow depth value 6 hours prior.">Snowfall<br>6 Hour<br>(in)</th><th title="This data is derived by taking\n the the snow depth value at the\n time listed and subtracting the\n snow depth value 24 hours prior.">Snowfall<br>24 Hour<br>(in)</th>';
                MetHeader += '<th id="snow_depth" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.snow_depth_set_1+'\',\'Snow Depth\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\');">Snow<br>Depth<br>(mm)</th><hd title="This data is derived by taking\n the the snow depth value at the\n time listed and subtracting the\n snow depth value 3 hours prior.">Snowfall<br>3 hour<br>(mm)</th><th title="This data is derived by taking\n the the snow depth value at the\n time listed and subtracting the\n snow depth value 6 hours prior.">Snowfall<br>6 Hour<br>(mm)</th><th title="This data is derived by taking\n the the snow depth value at the\n time listed and subtracting the\n snow depth value 24 hours prior.">Snowfall<br>24 Hour<br>(mm)</th>';
              }
            }
            var curSnow = '';
            if (DATA.STATION[0].OBSERVATIONS.snow_depth_set_1[j] !== null) {
              curSnow = (DATA.STATION[0].OBSERVATIONS.snow_depth_set_1[j]).toFixed(1);  
              var threeHRsnow = '';
              var sixHRsnow   = ''
              var oneDAYsnow  = ''
              if (pview == 'measured') {
                threeHRsnow = '';
                sixHRsnow   = ''
                oneDAYsnow  = ''
              } else if (pview == 'full') {
                threeHRsnow = getDerivedSnow(180,j,stamps,DATA.STATION[0].OBSERVATIONS.snow_depth_set_1);
                sixHRsnow   = getDerivedSnow(360,j,stamps,DATA.STATION[0].OBSERVATIONS.snow_depth_set_1);
                oneDAYsnow  = getDerivedSnow(1440,j,stamps,DATA.STATION[0].OBSERVATIONS.snow_depth_set_1);  
              } else if (minutes == '00' || j == numObs) {
                if (hours % 3 === 0 || j == numObs) {
                  threeHRsnow = getDerivedSnow(180,j,stamps,DATA.STATION[0].OBSERVATIONS.snow_depth_set_1);
                } 
                if (hours % 6 === 0 || j == numObs) {
                  sixHRsnow   = getDerivedSnow(360,j,stamps,DATA.STATION[0].OBSERVATIONS.snow_depth_set_1);
                }
                if (hours % 12 === 0 || j == numObs) {
                  oneDAYsnow  = getDerivedSnow(1440,j,stamps,DATA.STATION[0].OBSERVATIONS.snow_depth_set_1);
                }
              }
            }
            if (curSnow === undefined || DATA.STATION[0].OBSERVATIONS.snow_depth_set_1[j] === null) {
              curSnow = '';
            }
            if (threeHRsnow === undefined) {
              threeHRsnow = '';
            } 
            if (sixHRsnow === undefined) {
              sixHRsnow = '';
            }
            if (oneDAYsnow === undefined) {
              oneDAYsnow = '';
            } 
            if (pview == 'measured') { 
              var SNOW_DEPTH = '<td>'+curSnow+'</td>';
            } else {
              var SNOW_DEPTH = '<td>'+curSnow+'</td><td>'+threeHRsnow+'</td><td>'+sixHRsnow+'</td><td>'+oneDAYsnow+'</td>';
            }
          } else {
            var SNOW_DEPTH = '';
          }
          // Snow Interval 
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('snow_interval_set_1')) {
            if (j == 0) {
                plot_menu("snow_interval","Snow Interval");
              EngHeader += '<th id="snow_interval" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.snow_interval_set_1+'\',\'Snow Interval\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Snow<br>Interval<br>(in)</th>';
              MetHeader += '<th id="snow_interval" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.snow_interval_set_1+'\',\'Snow Interval\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Snow<br>Interval<br>(mm)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.snow_interval_set_1[j] !== null) {
              var SNOW_INTERVAL = '<td>'+(DATA.STATION[0].OBSERVATIONS.snow_interval_set_1[j]).toFixed(1)+'</td>';
            } else {
              var SNOW_INTERVAL = '<td>&nbsp;</td>';
            }
          } else {
            var SNOW_INTERVAL = '';
          }
          var SNOW_HR_24 = '';
          // Snow Interval 
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('snow_accum_set_1')) {
            if (j == 0) {
                plot_menu("snow_accum","Snow Interval");
              EngHeader += '<th id="snow_interval" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.snow_accum_set_1+'\',\'Snow Interval\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Snow<br>Interval<br>(in)</th>';
              MetHeader += '<th id="snow_interval" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.snow_accum_set_1+'\',\'Snow Interval\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Snow<br>Interval<br>(mm)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.snow_accum_set_1[j] !== null) {
              var SNOW_ACCUM = '<td>'+(DATA.STATION[0].OBSERVATIONS.snow_accum_set_1[j]).toFixed(1)+'</td>';
            } else {
              var SNOW_ACCUM = '<td>&nbsp;</td>';
            }
          } else {
            var SNOW_ACCUM = '';
          }
          var SNOW_HR_24 = '';
          // Snow Water Equivalent 
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('snow_water_equiv_set_1')) {
            if (j == 0) {
                plot_menu("snow_water","Snow Water Equivalent");
              EngHeader += '<th id="snow_water" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.snow_water_equiv_set_1+'\',\'Snow Water Equivalent\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Snow/Water<br>Equivalent<br>(in)</th>';
              MetHeader += '<th id="snow_water" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.snow_water_equiv_set_1+'\',\'Snow Water Equivalent\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Snow/Water<br>Equivalent<br>(mm)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.snow_water_equiv_set_1[j] !== null) {
              var SWE = '<td>'+(DATA.STATION[0].OBSERVATIONS.snow_water_equiv_set_1[j]).toFixed(2)+'</td>';
            } else {
              var SWE = '<td>&nbsp;</td>';
            }
          } else {
            var SWE = '';
          }
          // Snow Water Equivalent 
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('snow_water_equiv_set_2')) {
            if (j == 0) {
                plot_menu("snow_water2","Daily Snow Water Equivalent");
              EngHeader += '<th id="snow_water2" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.snow_water_equiv_set_2+'\',\'Snow Water Equivalent\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Daily<br>SWE<br>(in)</th>';
              MetHeader += '<th id="snow_water2" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.snow_water_equiv_set_2+'\',\'Snow Water Equivalent\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Daily<br>SWE<br>(mm)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.snow_water_equiv_set_2[j] !== null) {
              var SWE2 = '<td>'+(DATA.STATION[0].OBSERVATIONS.snow_water_equiv_set_2[j]).toFixed(2)+'</td>';
            } else {
              var SWE2 = '<td>&nbsp;</td>';
            }
          } else {
            var SWE2 = '';
          }
          // 6 Hour Max T
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('air_temp_high_6_hour_set_1')) {
            if (j == 0) {
              EngHeader += '<th>6 Hr<br>Max<br>(&deg;F)</th>';
              MetHeader += '<th>6 Hr<br>Max<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.air_temp_high_6_hour_set_1[j] !== null) {
              var HR6_MAXT  = '<td><font color="red">'+Math.round(DATA.STATION[0].OBSERVATIONS.air_temp_high_6_hour_set_1[j])+'</font></td>';
            } else {
              var HR6_MAXT  = '<td>&nbsp;</td>';
            }
          } else {
            var HR6_MAXT  = '';
          }
          // 6 Hour Min T
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('air_temp_low_6_hour_set_1')) {
            if (j == 0) {
              EngHeader += '<th>6 Hr<br>Min<br>(&deg;F)</th>';
              MetHeader += '<th>6 Hr<br>Min<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.air_temp_low_6_hour_set_1[j] !== null) {
              var HR6_MINT = '<td><font color="blue">'+Math.round(DATA.STATION[0].OBSERVATIONS.air_temp_low_6_hour_set_1[j])+'</font></td>';
            } else {
              var HR6_MINT = '<td>&nbsp;</td>';
            }
          } else {
            var HR6_MINT = '';
          }
          // 24 Hour Max T
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('air_temp_high_24_hour_set_1')) {
            if (j == 0) {
              EngHeader += '<th>24 Hr<br>Max<br>(&deg;F)</th>';
              MetHeader += '<th>24 Hr<br>Max<br>(&deg;C)</th>';
              }
            if (DATA.STATION[0].OBSERVATIONS.air_temp_high_24_hour_set_1[j] !== null) {
              var HR24_MAXT  = '<td><font color="red">'+Math.round(DATA.STATION[0].OBSERVATIONS.air_temp_high_24_hour_set_1[j])+'</font></td>';
            } else {
              var HR24_MAXT  = '<td>&nbsp;</td>';
            }
          } else {
            var HR24_MAXT  = '';
          }
          // 24 Hour Min T
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('air_temp_low_24_hour_set_1')) {
            if (j == 0) {
              EngHeader += '<th>24 Hr<br>Min<br>(&deg;F)</th>';
              MetHeader += '<th>24 Hr<br>Min<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.air_temp_low_24_hour_set_1[j] !== null) {
              var HR24_MINT = '<td><font color="blue">'+Math.round(DATA.STATION[0].OBSERVATIONS.air_temp_low_24_hour_set_1[j])+'</font></td>';
            } else {
              var HR24_MINT = '<td>&nbsp;</td>';
            }
          } else {
            var HR24_MINT = '';
          }
          // Water Temperature 
          if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('T_water_temp_set_1')) {
            if (j == 0) {
                plot_menu("water_temp","Water Temperature");
              EngHeader += '<th id="water_temp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.T_water_temp_set_1+'\',\'Water Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Water<br>Temp.<br>(&deg;F)</th>';
              MetHeader += '<th id="water_temp" class="zoom" title="Click to view chart" onclick="makeLineChart(\''+stamps+'\',\''+DATA.STATION[0].OBSERVATIONS.T_water_temp_set_1+'\',\'Water Temperature\',\''+units+'\',\''+TIMEZONE+'\',null,null,\''+network+'\',\''+hourly+'\',\''+numHours+'\')">Water<br>Temp.<br>(&deg;C)</th>';
            }
            if (DATA.STATION[0].OBSERVATIONS.T_water_temp_set_1[j] !== null) {
              var WATER_T = '<td>'+Math.round(DATA.STATION[0].OBSERVATIONS.T_water_temp_set_1[j])+'</td>';
            } else {
              var WATER_T = '<td>&nbsp;</td>';
            }
          } else {
            var WATER_T = '';
          }
          // Append one row of data to the stream
          // If the 'Hourly' flag is set to true, post only data between a range of 51 minutes past the hour to 4 minutes after.  This should catch most stuff
          if (hourly == 'true') {
            if (network == 'ASOS/AWOS') {
              // Actual ASOS/AWOS Sites report sea level pressure in "official" obs (METAR/SPECI)
              if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('sea_level_pressure_set_1')) {
                if (DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1[j] !== null) {
                  tableData += '<tr><td>'+timestamp+'</td>'+TEMP_F+DEWPOINT+RH_PCT+HI+WC+WIND_DIR+WIND_SPD+WIND_GUST+FUEL_T+FUEL_PCT+VISIBILITY+WEATHER+SKY_COND+SEALEVEL+P+ALTIMTER+STATION_P+SOLAR+SOLAR_PCT+SURF_T+SOIL_T+ROAD_T+SROAD_T+ACC_PCPN+MIN_1_PCPN+MIN_5_PCPN+MIN_10_PCPN+MIN_15_PCPN+MIN_30_PCPN+HR_1_PCPN+HR_3_PCPN+HR_6_PCPN+HR_24_PCPN+MIDNIGHT+PRECIPINT+SNOW_DEPTH+SNOW_INTERVAL+SNOW_ACCUM+SNOW_HR_24+SWE+SWE2+HR6_MAXT+HR6_MINT+HR24_MAXT+HR24_MINT+WATER_T+'</tr>';  
                  // METARS
                  if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('metar_set_1')) {  
                    if (DATA.STATION[0].OBSERVATIONS.metar_set_1[j] !== null) {
                      METARString += '<tr><td nowrap>'+DATA.STATION[0].OBSERVATIONS.metar_set_1[j]+'</td></tr>';
                    } else {
                     METARString += '';
                    }  
                  }
                // SPECI
                } else if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('metar_set_1')) {
                  if (DATA.STATION[0].OBSERVATIONS.metar_set_1[j] !== null) {
                    if (DATA.STATION[0].OBSERVATIONS.metar_set_1[j].toUpperCase().startsWith(SITE)) {
                      tableData += '<tr><td bgcolor="yellow"><strong>'+timestamp+'</strong></td>'+TEMP_F+DEWPOINT+RH_PCT+HI+WC+WIND_DIR+WIND_SPD+WIND_GUST+FUEL_T+FUEL_PCT+VISIBILITY+WEATHER+SKY_COND+SEALEVEL+P+ALTIMTER+STATION_P+SOLAR+SOLAR_PCT+SURF_T+SOIL_T+ROAD_T+SROAD_T+ACC_PCPN+MIN_1_PCPN+MIN_5_PCPN+MIN_10_PCPN+MIN_15_PCPN+MIN_30_PCPN+HR_1_PCPN+HR_3_PCPN+HR_6_PCPN+HR_24_PCPN+MIDNIGHT+PRECIPINT+SNOW_DEPTH+SNOW_INTERVAL+SNOW_ACCUM+SNOW_HR_24+SWE+SWE2+HR6_MAXT+HR6_MINT+HR24_MAXT+HR24_MINT+WATER_T+'</tr>';
                      METARString += '<tr><td nowrap><strong>SPECI '+DATA.STATION[0].OBSERVATIONS.metar_set_1[j]+'</strong></td></tr>';
                    } 
                  } else {
                    tableData += '';
                    METARString += '';
                  }
                } else {
                  tableData += '';
                  METARString += '';
                }
              // Non fed sites 
              } else {
                if (minutes.toString() == '51' || minutes.toString() == '52' || minutes.toString() == '53' || minutes.toString() == '54' || minutes.toString() == '55' || minutes.toString() == '56' || minutes.toString() == '57' || minutes.toString() == '58' || minutes.toString() == '59') {
                  tableData += '<tr><td>'+timestamp+'</td>'+TEMP_F+DEWPOINT+RH_PCT+HI+WC+WIND_DIR+WIND_SPD+WIND_GUST+FUEL_T+FUEL_PCT+VISIBILITY+WEATHER+SKY_COND+SEALEVEL+P+ALTIMTER+STATION_P+SOLAR+SOLAR_PCT+SURF_T+SOIL_T+ROAD_T+SROAD_T+ACC_PCPN+MIN_1_PCPN+MIN_5_PCPN+MIN_10_PCPN+MIN_15_PCPN+MIN_30_PCPN+HR_1_PCPN+HR_3_PCPN+HR_6_PCPN+HR_24_PCPN+MIDNIGHT+PRECIPINT+SNOW_DEPTH+SNOW_INTERVAL+SNOW_ACCUM+SNOW_HR_24+SWE+SWE2+HR6_MAXT+HR6_MINT+HR24_MAXT+HR24_MINT+WATER_T+'</tr>';
                  METARString += '<tr><td nowrap>'+DATA.STATION[0].OBSERVATIONS.metar_set_1[j]+'</td></tr>';
                } else {
                  tableData += '';
                  METARString += '';
                }
              } 
            } else if (minutes.toString() == '00' || minutes.toString() == '01' || minutes.toString() == '02' || minutes.toString() == '03' || minutes.toString() == '04' || minutes.toString() == '56' || minutes.toString() == '57' || minutes.toString() == '58' || minutes.toString() == '59') {
              tableData += '<tr><td>'+timestamp+'</td>'+TEMP_F+DEWPOINT+RH_PCT+HI+WC+WIND_DIR+WIND_SPD+WIND_GUST+FUEL_T+FUEL_PCT+VISIBILITY+WEATHER+SKY_COND+SEALEVEL+P+ALTIMTER+STATION_P+SOLAR+SOLAR_PCT+SURF_T+SOIL_T+ROAD_T+SROAD_T+ACC_PCPN+MIN_1_PCPN+MIN_5_PCPN+MIN_10_PCPN+MIN_15_PCPN+MIN_30_PCPN+HR_1_PCPN+HR_3_PCPN+HR_6_PCPN+HR_24_PCPN+MIDNIGHT+PRECIPINT+SNOW_DEPTH+SNOW_INTERVAL+SNOW_ACCUM+SNOW_HR_24+SWE+SWE2+HR6_MAXT+HR6_MINT+HR24_MAXT+HR24_MINT+WATER_T+'</tr>';  
            } else if (numHours >= numObs) {
              tableData += '<tr><td>'+timestamp+'</td>'+TEMP_F+DEWPOINT+RH_PCT+HI+WC+WIND_DIR+WIND_SPD+WIND_GUST+FUEL_T+FUEL_PCT+VISIBILITY+WEATHER+SKY_COND+SEALEVEL+P+ALTIMTER+STATION_P+SOLAR+SOLAR_PCT+SURF_T+SOIL_T+ROAD_T+SROAD_T+ACC_PCPN+MIN_1_PCPN+MIN_5_PCPN+MIN_10_PCPN+MIN_15_PCPN+MIN_30_PCPN+HR_1_PCPN+HR_3_PCPN+HR_6_PCPN+HR_24_PCPN+MIDNIGHT+PRECIPINT+SNOW_DEPTH+SNOW_INTERVAL+SNOW_ACCUM+SNOW_HR_24+SWE+SWE2+HR6_MAXT+HR6_MINT+HR24_MAXT+HR24_MINT+WATER_T+'</tr>';
            } else {
              tableData += '';
            }
          } else if (hourly == 'false') {
            // METARS
            if (DATA.STATION[0].OBSERVATIONS.hasOwnProperty('metar_set_1')) {  
              if (DATA.STATION[0].OBSERVATIONS.metar_set_1[j] !== null) {
                METARString += '<tr><td nowrap>'+DATA.STATION[0].OBSERVATIONS.metar_set_1[j]+'</td></tr>';
              } else {
              METARString += '';
              }  
            }
            tableData += '<tr><td>'+timestamp+'</td>'+TEMP_F+DEWPOINT+RH_PCT+HI+WC+WIND_DIR+WIND_SPD+WIND_GUST+FUEL_T+FUEL_PCT+VISIBILITY+WEATHER+SKY_COND+SEALEVEL+P+ALTIMTER+STATION_P+SOLAR+SOLAR_PCT+SURF_T+SOIL_T+ROAD_T+SROAD_T+ACC_PCPN+MIN_1_PCPN+MIN_5_PCPN+MIN_10_PCPN+MIN_15_PCPN+MIN_30_PCPN+HR_1_PCPN+HR_3_PCPN+HR_6_PCPN+HR_24_PCPN+MIDNIGHT+PRECIPINT+SNOW_DEPTH+SNOW_INTERVAL+SNOW_ACCUM+SNOW_HR_24+SWE+SWE2+HR6_MAXT+HR6_MINT+HR24_MAXT+HR24_MINT+WATER_T+'</tr>';  
          }
        } // Successful return of data
        if (cwa !== null) {
          var officeLink = ' - <a href="https://www.weather.gov/'+cwa+'">'+cwa+'</a>';
          var selectedObs = '<div id="localwx">For selected observations near this location: <a href="/wrh/localweather?zone='+nwsZone.substr(0,2)+'Z'+nwsZone.substr(2,3)+'" target="_BLANK">click here</a></div><br>&nbsp;'
        } else {
          var officeLink = '';
          var selectedObs = '';
        }
        if (headers == 'none') {
          var header0 = '';
          var CSS = '<link href="/source/wrh/timeseries/style.css" rel="stylesheet" />';
          var divToWrite = '.content';
        } else if (headers == 'min') {
          var header0 = '<div id="SITE"><p>Weather conditions for:<br>'+stnNAM+', '+ state +' ('+NETWORK+officeLink+') <br>Elev: '+stnELE+' ft; Lat/Lon: '+stnLAT+'/'+stnLON+'</div>';
          var CSS = '<link href="/source/wrh/timeseries/style.css" rel="stylesheet" />';
          var divToWrite = '.content';
        } else {
          if (has_precip == 1 || network == 'ASOS/AWOS') {
            var header0 = '<div id="SITE"><p>Weather conditions for:<br>'+stnNAM+', '+ state +' ('+NETWORK+officeLink+') <br>Elev: '+stnELE+' ft; Lat/Lon: '+stnLAT+'/'+stnLON+'<br><font color="green"><div onclick="getCalYearPrecip(\''+SITE+'\',\''+units+'\');" id="CAL_YEAR"><u>Get Yearly Precip Total (non QA/QC\'d data) </u></div><div onclick="getH2OYearPrecip(\''+SITE+'\',\''+units+'\');" id="H2O_YEAR"><u>Get Water Year Precip Total (non QA/QC\'d data): </u></div></font></div>'+selectedObs;
            var CSS = '';
            var divToWrite = '#OBS';
          } else {
            var header0 = '<div id="SITE"><p>Weather conditions for:<br>'+stnNAM+', '+ state +' ('+NETWORK+officeLink+') <br>Elev: '+stnELE+' ft; Lat/Lon: '+stnLAT+'/'+stnLON+'<br>&nbsp;</div>'+selectedObs;
            var CSS = '';
            var divToWrite = '#OBS';
          }
        }
        if (format == 'raw' && network == 'ASOS/AWOS') {
          $(divToWrite).html(CSS+ header0 + EngHeader + METARString+'</table>');
          $('#HEADER').hide();
        } else if (units == 'english' || units == 'english_k') {
          $(divToWrite).html(CSS+ header0 + EngHeader +'</tr></thead><tbody>' + tableData+'</tbody></table>');
          $('#HEADER').show();
        } else {
          $(divToWrite).html(CSS+ header0 + MetHeader +'</tr></thead><tbody>' + tableData+'</tbody></table>');
          $('#HEADER').show();
        }
        //if (fontSize !== undefined || fontSize != '12') {
        //  $('#OBS_DATA').css({'font-size': fontSize});
        //resizePage();
        //} else { 
        //  resizePage(); 
        //}
        if (chart == 'on') {
          var DATA1 = '';
          var DATA2 = '';
          var DATA3 = '';
          var chartLabel = '';
          if (DATA.STATION[0].OBSERVATIONS.air_temp_set_1) {
            var chartBit = '1';
            DATA1 = DATA.STATION[0].OBSERVATIONS.air_temp_set_1;
            chartLabel += 'Temperature';
          }  
          if (DATA.STATION[0].OBSERVATIONS.dew_point_temperature_set_1d) {
            DATA2 = DATA.STATION[0].OBSERVATIONS.dew_point_temperature_set_1d;
            if (chartLabel) {
              chartLabel += '& Dew Point';
            } else {
              chartLabel += 'Dew Point'; 
            }      
          } 
          if (DATA.STATION[0].OBSERVATIONS.relative_humidity_set_1) {
            DATA3 = DATA.STATION[0].OBSERVATIONS.relative_humidity_set_1
            if (chartLabel) {
              chartLabel += '& Relative Humidity';
            } else {
              chartLabel += 'Relative Humidity'; 
            }      
          }
          if (DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1) {
            SLPData = DATA.STATION[0].OBSERVATIONS.sea_level_pressure_set_1;
          } else {
            SLPData = undefined;
          }
          if (plot) {
            $('#'+plot).click();
          } else if (chartLabel) {
            makeLineChart(''+stamps+'',''+DATA1+'',chartLabel,units,TIMEZONE,''+DATA2+'',''+DATA3+'',network,hourly,numHours,''+SLPData+'');
          } else {
            $('#container').hide(); 
          }  
        }
      } else {
        // Station has not reported in the specified number of hours
        $('#container').hide();
        SITE = SITE.replace('COOP','');
        $('#OBS').html('<h2>'+SITE +' has no data available for the requested time period</h2>');
      }
      resizePage(fontSize); 
    } else { //if (DATA.SUMMARY.RESPONSE_MESSAGE.substr(0,33)  == 'No stations found for this request') {
      // Maybe this is a COOP site, so let's check, just in case
      if (SITE.toLowerCase().substr(0,4) != 'coop') {
        monitorOBS('COOP'+SITE,numHours,units,format,headers,chart,hourly,history,start,end,pview,fontSize) 
      // Station ID not valid
      } else {
        $('#container').hide();
        SITE = SITE.replace('COOP','');
        $('#OBS').html('<h2>'+SITE +' is not a valid station identifier.</h2>');
      }
    }
  })
}
/////////////////////////////////////
function plot_menu(in_id,in_string) {
  var out_string="<option value='"  +in_id+  "'>" + in_string + "</option>";
  $(".plot_select").append(out_string);
  $(".perm_select").append(out_string);
}
$(function(){
  $('.plot_select').change(function(){
    $( "#" + $(this).val() ).trigger( "click" );
  });
});
/////////////////////////////////////
function getWeatherCode(WEATHER) {
  // Documentation:  https://blog.synopticlabs.org/blog/2016/09/26/weather-condition-codes.html
  // Coloring from MesoWest:
  // '/TS|SQ|FC/      <font color=red><b>$r_wx</b></font></td>"; }
  // '/RA|SN|GS|GR    <font color=green><b>$r_wx</b></font></td>"; }
  // '/FG|FU|BS/      <font color=#FF00FF><b>$r_wx</b></font></td>"; }
  // '/BR|HZ/         <font color=orange><b>$r_wx</b></font></td>"; } 
  if (WEATHER == -3) {
    HTML = '<font color="red">FC</font>';
    DESC = 'Water Spout'; 
  } else if (WEATHER == -2) {
    HTML = '<font color="red">FC</font>';
    DESC = 'Funnel Cloud';
  } else if (WEATHER == -1) {
    HTML = '<font color="red">FC</font>';
    DESC = 'Tornado';
  } else if (WEATHER == 1) {
    HTML = '<font color="green">RA</font>';
    DESC = 'Rain';
  } else if (WEATHER == 2) {
    HTML = '<font color="green">DZ</font>';
    DESC = 'Drizzle';
  } else if (WEATHER == 3) {
    HTML = '<font color="green">SN</font>';
    DESC = 'Snow';
  } else if (WEATHER == 4) {
    HTML = '<font color="green">GR</font>';
    DESC = 'Hail';
  } else if (WEATHER == 5) {
    HTML = '<font color="red">TS</font>';
    DESC = 'Thunder';
  } else if (WEATHER == 6) {
    HTML = '<font color="orange">HZ</font>';
    DESC = 'Haze';
  } else if (WEATHER == 7) {
    HTML = '<font color="#FF00FF">FU</font>';
    DESC = 'Smoke';
  } else if (WEATHER == 8) {
    HTML = '<font color="#FF00FF">DU</font>';
    DESC = 'Dust';
  } else if (WEATHER == 9) {
    HTML = '<font color="#FF00FF">FG</font>';
    DESC = 'Fog';
  } else if (WEATHER == 10) {
    HTML = '<font color="red">SQ</font>';
    DESC = 'Squalls';
  } else if (WEATHER == 11) {
    HTML = '<font color="#FF00FF">VA</font>';
    DESC = 'Volcanic Ash';
  } else if (WEATHER == 13) {
    HTML = '<font color="green">-RA</font>';
    DESC = 'Lt rain';
  } else if (WEATHER == 14) {
    HTML = '<font color="green">+RA</font>';
    DESC = 'Hvy rain';
  } else if (WEATHER == 15) {
    HTML = '<font color="red">ZR</font>';
    DESC = 'Freezing rain';
  } else if (WEATHER == 16) {
    HTML = '<font color=green"">SH</font>';
    DESC = 'Shwrs';
  } else if (WEATHER == 17) {
    HTML = '<font color="green">-DZ</font>';
    DESC = 'Lt drizzle';
  } else if (WEATHER == 18) {
    HTML = '<font color="green">+DZ</font>';
    DESC = 'Hvy drizzle';
  } else if (WEATHER == 19) {
    HTML = '<font color="green">FZDZ</font>';
    DESC = 'Freezing drizzle';
  } else if (WEATHER == 20) {
    HTML = '<font color="green">-SN</font>';
    DESC = 'Lt snow';
  } else if (WEATHER == 21) {
    HTML = '<font color="green">+SN</font>';
    DESC = 'Hvy snow';
  } else if (WEATHER == 22) {
    HTML = '<font color="green">SN</font>';
    DESC = 'Snow';
  } else if (WEATHER == 23) {
    HTML = '<font color="green">PL</font>';
    DESC = 'Ice pellets';
  } else if (WEATHER == 24) {
    HTML = '<font color="green">SG</font>';
    DESC = 'Snow grains';
  } else if (WEATHER == 25) {
    HTML = '<font color="green">GS</font>';
    DESC = 'Snow pellets';
  } else if (WEATHER == 26) {
    HTML = '<font color="green">-GR</font>';
    DESC = 'Lt hail';
  } else if (WEATHER == 27) {
    HTML = '<font color="green">+GR</font>';
    DESC = 'Hvy hail';
  } else if (WEATHER == 28) {
    HTML = '<font color="red">-TS</font>';
    DESC = 'Lt thunderstorm';
  } else if (WEATHER == 29) {
    HTML = '<font color="red">+TS</font>';
    DESC = 'Hvy thunderstorm';
  } else if (WEATHER == 30) {
    HTML = '<font color="#FF00FF">FZFG</font>';
    DESC = 'Freezing Fog';
  } else if (WEATHER == 31) {
    HTML = '<font color="orange">BR</font>';
    DESC = 'Mist';
  } else if (WEATHER == 32) {
    HTML = '<font color="orange">BLSN</font>';
    DESC = 'Blowing snow';
  } else if (WEATHER == 33) {
    HTML = '<font color="orange">BLDU</font>';
    DESC = 'Blowing dust';
  } else if (WEATHER == 34) {
    HTML = '<font color="orange">BLPY</font>';
    DESC = 'Blowing spray';
  } else if (WEATHER == 35) {
    HTML = '<font color="orange">BLSA</font>';
    DESC = 'Blowing sand';
  } else if (WEATHER == 36) {
    HTML = '<font color="green">IC</font>';
    DESC = 'Ice crystals';
  } else if (WEATHER == 37) {
    HTML = '<font color="green">IC</font>';
    DESC = 'Ice needles';
  } else if (WEATHER == 38) {
    HTML = '<font color="green">-GR</font>';
    DESC = 'Lt hail';
  } else if (WEATHER == 39) {
    HTML = '<font color="orange">FUHZ</font>';
    DESC = 'Smoke, haze';
  } else if (WEATHER == 40) {
    HTML = '<font color="orange">DU</font>';
    DESC = 'Dust whirls';
  } else if (WEATHER == 41) {
    HTML = 'UP';
    DESC = 'Unknown precipitation';
  } else if (WEATHER == 49) {
    HTML = '<font color="red">-ZR</font>';
    DESC = 'Lt freezing rain';
  } else if (WEATHER == 50) {
    HTML = '<font color="red">+ZR</font>';
    DESC = 'Heavy freezing rain';
  } else if (WEATHER == 51) {
    HTML = '<font color="green">-SH</font>';
    DESC = 'Lt shwrs';
  } else if (WEATHER == 52) {
    HTML = '<font color="green">+SH</font>';
    DESC = 'Hvy shwrs';
  } else if (WEATHER == 53) {
    HTML = '<font color="green">-FZDZ</font>';
    DESC = 'Lt freezing drizzle';
  } else if (WEATHER == 54) {
    HTML = '<font color="green">+FZDZ</font>';
    DESC = 'Hvy freezing drizzle';
  } else if (WEATHER == 55) {
    HTML = '<font color="green">-SN</font>';
    DESC = 'Lt snow';
  } else if (WEATHER == 56) {
    HTML = '<font color="green">+SN</font>';
    DESC = 'Hvy snow';
  } else if (WEATHER == 57) {
    HTML = '<font color="green">-PL</font>';
    DESC = 'Lt ice pellets';
  } else if (WEATHER == 58) {
    HTML = '<font color="green">+PL</font>';
    DESC = 'Hvy ice pellets';
  } else if (WEATHER == 59) {
    HTML = '<font color="green">-SG</font>';
    DESC = 'Lt snow grains';
  } else if (WEATHER == 60) {
    HTML = '<font color="green">+SG</font>';
    DESC = 'Heavy snow grains';
  } else if (WEATHER == 61) {
    HTML = '<font color="green">-GS</font>';
    DESC = 'Lt snow pellets';
  } else if (WEATHER == 62) {
    HTML = '<font color="green">+GS</font>';
    DESC = 'Hvy snow pellets';
  } else if (WEATHER == 63) {
    HTML = '<font color="green">PL</font>';
    DESC = 'Ice pellets';
  } else if (WEATHER == 64) {
    HTML = '<font color="green">-IC</font>';
    DESC = 'Lt ice crystals';
  } else if (WEATHER == 65) {
    HTML = '<font color="green">+IC</font>';
    DESC = 'Hvy ice crystals';
  } else if (WEATHER == 66) {
    HTML = '<font color="red">TSRA</font>';
    DESC = 'Thunder shwr';
  } else if (WEATHER == 67) {
    HTML = '<font color="green">GS</font>';
    DESC = 'Snow pellets';
  } else if (WEATHER == 68) {
    HTML = '<font color="orange">+BLDU</font>';
    DESC = 'Hvy blowing dust';
  } else if (WEATHER == 69) {
    HTML = '<font color="orange">+BLSA</font>';
    DESC = 'Hvy blowing sand';
  } else if (WEATHER == 69) {
    HTML = '<font color="orange">+BLSN</font>';
    DESC = 'Hvy blowing snow';
  } else if (WEATHER == 75) {
    HTML = '<font color="green">-PL</font>';
    DESC = 'Lt ice pellets';
  } else if (WEATHER == 76) {
    HTML = '<font color="green">+PL</font>';
    DESC = 'Hvy ice pellets';
  } else if (WEATHER == 77) {
    HTML = '<font color="red">-TSRA</font>';
    DESC = 'Lt thunder shwr';
  } else if (WEATHER == 78) {
    HTML = '<font color="red">+TSRA</font>';
    DESC = 'Hvy thunder shwr';
  }
  return(DESC);
}

// Not needed, but still here
function getWindDir(windDir) {
  var cardDir = '';
  if (windDir < 22) {
    cardDir = 'N';
  } else if (windDir < 68) {
    cardDir = 'NE';
  } else if (windDir < 113) {
    cardDir = 'E';
  } else if (windDir < 158) {
    cardDir = 'SE';
  } else if (windDir < 203) {
    cardDir = 'S';
  } else if (windDir < 248) {
    cardDir = 'SW';
  } else if (windDir < 293) {
    cardDir = 'W';
  } else if (windDir < 338) {
    cardDir = 'NW';
  } else {
    cardDir = 'N';
  }
  return cardDir;
}

// Not needed, but still here 
function calcWindChill(TEMP,SPEED,SYS) {
  if (TEMP != 'undefined' && SPEED != 'undefined') {
    if (SYS == 'metric') {
      TEMP = (TEMP*9/5) +32;
      SPEED = (SPEED*2.237);
    }
    if (TEMP < 50 && SPEED > 3) { 
      var WC = (Math.round(35.74+0.6215*TEMP - 35.75 * Math.pow(SPEED,0.16) + 0.4275 * TEMP * Math.pow(SPEED,0.16)).toFixed(0));
      if (SYS == 'metric') {
        WC = Math.round((WC-32)*5/9);
      }
      return ('<td class="WC">'+WC+'</td>');
    } else {
      return ('<td class="WC">&nbsp;</td>');
    }
  } else {
    return ('<td class="WC">&nbsp;</td>');
  }
}

// Old WRH Function
function calcSolarPCT(dattim,xlat,xlon) {
  var utcMoment = moment.utc(dattim);
  var d = new Date(utcMoment.format());
  var rd = new Date(utcMoment.format());
  rd.setHours(rd.getHours() - 1);
  var hours = utcMoment.format("H");
  var minutes = d.getMinutes();
  minutes = minutes < 10 ? '0' + minutes : minutes;
  var solpot = 0;
  while (rd < d) {
    var start = new Date(rd.getFullYear(), 0, 0);
    var diff = rd - start;
    var oneDay = 1000 * 60 * 60 * 24;
    var julday = Math.floor(diff / oneDay) - 1;
    var hr = rd.getHours();
        hr = utcMoment.format("H") - 1;
    var min = rd.getMinutes();
        min = utcMoment.format('m');
    xt24 = hr + (min / 60.);

    var degrad = 0.017453293;
    var dpd = 0.986301;
    var solset = -999;
    var sinob = Math.sin(23.5 * degrad);
    var julian = (julday) + hr;
    var xlong;
    if (julian > 80.) {
      xlong = dpd * (julian - 80.);
    } else {
      xlong = dpd * (julian + 285.);
    }
    xlong = xlong * degrad;
    declin = Math.asin(sinob * Math.sin(xlong));
    decdeg = declin / degrad;

    djul = julian * 360. / 365.;
    rjul = djul * degrad;
    eccfac = 1.000110 + 0.034221 * Math.cos(rjul) + 0.00128 * Math.sin(rjul) + 0.000719 * Math.cos(2 * rjul) + 0.000077 * Math.sin(2 * rjul);
    solcon = 1370. * eccfac;
    tlocap = xt24 + (xlon / 15.);
    omega = 15. * (tlocap - 12.) * degrad;
    xxlat = xlat * degrad;
    fracsc = Math.sin(declin) * Math.sin(xxlat) + Math.cos(declin) * Math.cos(xxlat) * Math.cos(omega);
    solpot = solpot + (fracsc * solcon);
    utcMoment.add(10, 'm');
    rd = new Date(rd.getTime() + 10 * 60000);
  }
  solpot = solpot / 6.;
  if (solpot > 0) {
    return(solpot.toFixed(0));
  } else {
    return '--';
  }
}

function makeLineChart(TIME,DATA0,LABEL,units,TIMEZONE,DATA1,DATA2,network,hourly,numHours,SLP) {
  $('#container').show();
  var ARRAY0 = [];
  var ARRAY1 = [];
  var ARRAY2 = [];
  var stamp = TIME;
  var MAXVAL = -1000;
  var MINVAL =  1000;
  TIME = TIME.split(',');
  DATA0 = DATA0.split(',');
  if (DATA1) {
    DATA1 = DATA1.split(',');
  }
  if (DATA2) {
    DATA2 = DATA2.split(',');
  }
  if (SLP) {
    SLP = SLP.split(',');
  }
  var numPoints = TIME.length;  
  if (hourly == 'true') {
    var numObsPerHour   = numPoints/numHours;
    var numChartableObs = numPoints/numObsPerHour;
    if (numChartableObs > 1000) {
      var increment = Math.ceil(numPoints/numObsPerHour)
    } else {
      var increment = 1;
    }
  } else if (numPoints > 1000) {
    var increment = Math.ceil(numPoints/1000);  
  } else {
    var increment = 1;
  }
  console.log('We have '+numPoints+' pieces of time stamped');
  console.log('data to chart. After calculating the best ')
  console.log('scenario, we are going to increment every');
  console.log(increment+ ' piece of data on the chart.');
  for (i=0; i < numPoints; i+=increment) {
    var minutes = (moment(TIME[i]).tz(TIMEZONE).format('mm')).toString();
    //console.log(TIME[i]);
    var tmpTimestamp = parseInt(moment(TIME[i]).format('x'));
    if (LABEL == 'Temperature' || LABEL == 'Dew Point Temperature' || LABEL == 'Wind Chill' || LABEL == 'Fuel Temperature' || LABEL == 'Road Temperature' || LABEL == 'Subsurface Road Temperature' || LABEL == 'Water Temperature' || LABEL == 'Relative Humidity' || LABEL == 'Fuel Moisture' ||LABEL == 'Wind Speed & Gusts' || LABEL == 'Solar Radiation') {
      var plotValue0 = Math.round(DATA0[i]);
      if (plotValue0 >= MAXVAL) {
        MAXVAL = plotValue0;
      }
      if (plotValue0 <= MINVAL) {
        MINVAL = plotValue0;
      }
      if (LABEL == 'Wind Chill' && (Math.round(DATA0[i]) =='0')) {
        var plotValue0 = null;
      }
      if (DATA1) {
        var plotValue1 = Math.round(DATA1[i]);
        if (plotValue1 >= MAXVAL) {
          MAXVAL = plotValue1;
        }
        if (plotValue1 <= MINVAL) {
          MINVAL = plotValue1;
        }
        if (LABEL == 'Wind Speed & Gusts' && (Math.round(DATA1[i]) =='0')) { 
          var plotValue1 = null; 
        }
      } 
      if (DATA2) {
        var plotValue2 = Math.round(DATA2[i]);
      } 
    } else {
      var plotValue0 = parseFloat(DATA0[i]);
      if (plotValue0 >= MAXVAL) {
        MAXVAL = plotValue0;
      }
      if (plotValue0 <= MINVAL) {
        MINVAL = plotValue0;
      }
      if (DATA1) {
        var plotValue1 = parseFloat(DATA1[i]);
        if (plotValue1 >= MAXVAL) {
          MAXVAL = plotValue1;
        }
        if (plotValue1 <= MINVAL) {
          MINVAL = plotValue1;
        }
      } 
      if (DATA2) {
        var plotValue2 = parseFloat(DATA2[i]);
      } 
    }
    if (hourly == 'true') {
      if (network == 'ASOS/AWOS') {
        if (SLP[i] !='') {
          ARRAY0.push({
            x: tmpTimestamp,
            y: plotValue0
          })
          if (DATA1) {
            ARRAY1.push({
              x: tmpTimestamp,
              y: plotValue1
            })
          }
          if (DATA2) {
            ARRAY2.push({
              x: tmpTimestamp,
              y: plotValue2
            })
          }
        }
      } else if (minutes == '00' || minutes == '01' || minutes == '02' || minutes == '03' || minutes == '04' || minutes == '56' || minutes == '57' || minutes == '58' || minutes == '59') {
        ARRAY0.push({
          x: tmpTimestamp,
          y: plotValue0
        })
        if (DATA1) {
          ARRAY1.push({
            x: tmpTimestamp,
            y: plotValue1
          })
        }
        if (DATA2) {
          ARRAY2.push({
            x: tmpTimestamp,
            y: plotValue2
          })
        }
      } else if (numHours >= numPoints) {
        ARRAY0.push({
          x: tmpTimestamp,
          y: plotValue0
        })
        if (DATA1) {
          ARRAY1.push({
            x: tmpTimestamp,
            y: plotValue1
          })
        }
        if (DATA2) {
          ARRAY2.push({
            x: tmpTimestamp,
            y: plotValue2
          })
        }
      } else {
        ARRAY0=ARRAY0;
        ARRAY1=ARRAY1;
        ARRAY2=ARRAY2;
      }
    } else {
      ARRAY0.push({
        x: tmpTimestamp,
        y: plotValue0
      })
      if (DATA1) {
        ARRAY1.push({
          x: tmpTimestamp,
          y: plotValue1
        })
      }
      if (DATA2) {
        ARRAY2.push({
          x: tmpTimestamp,
          y: plotValue2
        })
      }
    }
  }
  
  if (LABEL == 'Temperature& Dew Point& Relative Humidity') {
    MAXVAL = ((Math.ceil(MAXVAL/10))*10);
    MINVAL = ((Math.ceil(MINVAL/10))*10)-10;
    //console.log(MAXVAL,MINVAL)
  } else if (LABEL == 'Visibility') {
    MAXVAL = '10';
    MINVAL = '0';
  } else {
    MAXVAL = MAXVAL;
    MINVAL = MINVAL;
  }
  var y2VIS= false;
  if (LABEL == 'Temperature& Dew Point& Relative Humidity') {
    var LABELTEXT = 'Temperature & Dew Point';
    var stream = [
      { name: 'Temperature', 
        lineWidth: 2, 
        marker: {
          enabled: false
        },
        data: ARRAY0, 
        yAxis : '0' }, 
      { name: 'Dew Point', 
        lineWidth: 2, 
        marker: {
          enabled: false
        },
        data: ARRAY1, 
        yAxis : '0' }, 
      { name: 'Relative Humidity', 
        lineWidth: 2, 
        color: '#25c63e', 
        marker: {
          enabled: false
        },
        data: ARRAY2, 
        yAxis : '1'  }
    ];
    y2VIS= true;
  } else if (LABEL == 'Sea Level Pressure') {
    var LABELTEXT = 'Sea Level Pressure';
    var stream = [
    { name: 'Pressure',
      type: 'line',
      lineWidth: 0,
      states: {
          hover: {
          lineWidthPlus: 0
        }
      },
      marker: {
        radius: 2,
        symbol: 'circle',
        enabled: true
      },
      data: ARRAY0, yAxis : '0'  }
    ];
  } else {
    var LABELTEXT = LABEL;
    var stream = [
      { name: LABEL, 
        lineWidth: 2, 
        data: ARRAY0, 
        marker: {
          enabled: false
        },
        yAxis : '0' }
    ];
  }
  Highcharts.setOptions({
    time: {
      timezone: TIMEZONE
    }
  });
  $('#container').highcharts({
    title: {
      text:'' 
    },
    subtitle: {
      text: 'Desktop users: Click and drag in the plot area to zoom in<br>Mobile users: Pinch the chart to zoom in'
    },
    chart: {
      zoomType: 'xy',
          type: 'line',
    alignTicks: false
    },
    xAxis: {
      alternateGridColor: '#f4f0ec',
      type: 'datetime',
      minPadding: 0.1,
      maxPadding: 0.1,
      tickInterval: 6 * 3600 * 1000
    },
    yAxis: [{
      id: '0',
      title: {
        text: LABELTEXT,
        style: {
        color: Highcharts.getOptions().colors[0]
        }
      },
      labels: {
            style: {
                color: Highcharts.getOptions().colors[0]
            }
        }
    }, {
      id: '1',
      opposite: true,
      max: 100,
      min: 0,
      visible: y2VIS,
      title: {
        text: 'Relative Humidity',
        style: {
        color: '#25c63e'
        }
      },
      labels: {
            style: {
                color: '#25c63e'
            }
        }
    }],
    plotOptions: {
        series: {
            pointWidth: 1 
        }
    },
    tooltip: {
        xDateFormat: '%b %d, %l:%M %p',
        split: true,
        distance: 30,
        padding: 5
    },
    series: stream
  })
}

function makeWindChart(TIME,DATA0,LABEL,units,TIMEZONE,DATA1,DATA2,network,hourly,numHours,SLP) {
  $('#container').show();
  var ARRAY0 = [];
  var ARRAY1 = [];
  var ARRAY2 = [];
  TIME = TIME.split(',');
  DATA0 = DATA0.split(',');
  if (DATA1) {
    DATA1 = DATA1.split(',');
  }
  if (DATA2) {
    DATA2 = DATA2.split(',');
  }
  if (SLP) {
    SLP = SLP.split(',');
  }

  var numPoints = TIME.length;
  if (hourly == 'true') {
    var numObsPerHour   = numPoints/numHours;
    var numChartableObs = numPoints/numObsPerHour;
    if (numChartableObs > 1000) {
      var increment = Math.ceil(numPoints/numObsPerHour)
    } else {
      var increment = 1;
    }
  } else if (numPoints > 1000) {
    var increment = Math.ceil(numPoints/1000);
  } else {
    var increment = 1;
  }
  console.log('We have '+numPoints+' pieces of time stamped');
  console.log('data to chart. After calculating the best ')
  console.log('scenario, we are going to increment every');
  console.log(increment+ ' piece of data on the chart.');
  for (i=0; i < numPoints; i+=increment) {
    var minutes = moment(TIME[i]).tz(TIMEZONE).format('mm');
    var tmpTimestamp = parseInt(moment(TIME[i]).format('x'));
    if (units == 'english' || units == 'english_k') {
      var plotValue0 = Math.round(DATA0[i]);
      if (DATA1) {
        var plotValue1 = Math.round(DATA1[i]);
        if (LABEL == 'Wind Speed & Gusts' && (Math.round(DATA1[i]) =='0')) { 
          var plotValue1 = null; 
        }
      } 
    } else {
      var plotValue0 = Math.round((DATA0[i])*3.6);
      if (DATA1) {
        var plotValue1 = Math.round((DATA1[i])*3.6);
        if (LABEL == 'Wind Speed & Gusts' && (Math.round(DATA1[i]) =='0')) {
          var plotValue1 = null;
        }
      }
    } 
    if (DATA2) {
      var plotValue2 = Math.round(DATA2[i]);
    } 
    if (hourly == 'true') {
      if (network == 'ASOS/AWOS') {
        if (SLP[i] !='') {
          ARRAY0.push({
            x: tmpTimestamp,
            y: plotValue0
          })
          if (DATA1) {
            ARRAY1.push({
              x: tmpTimestamp,
              y: plotValue1
            })
          }
          if (DATA2) {
            ARRAY2.push({
              x: tmpTimestamp,
              y: plotValue2
            })
          }
        }
      } else if (minutes == '00' || minutes == '01' || minutes == '02' || minutes == '03' || minutes == '04' || minutes == '56' || minutes == '57' || minutes == '58' || minutes == '59') {
        ARRAY0.push({
          x: tmpTimestamp,
          y: plotValue0
        })
        if (DATA1) {
          ARRAY1.push({
            x: tmpTimestamp,
            y: plotValue1
          })
        }
        if (DATA2) {
          ARRAY2.push({
            x: tmpTimestamp,
            y: plotValue2
          })
        }
      } else if (numHours >= numPoints) {
        ARRAY0.push({
          x: tmpTimestamp,
          y: plotValue0
        })
        if (DATA1) {
          ARRAY1.push({
            x: tmpTimestamp,
            y: plotValue1
          })
        }
        if (DATA2) {
          ARRAY2.push({
            x: tmpTimestamp,
            y: plotValue2
          })
        }
      } else {
        ARRAY0=ARRAY0;
        ARRAY1=ARRAY1;
        ARRAY2=ARRAY2;
      }
    } else {
      ARRAY0.push({
        x: tmpTimestamp,
        y: plotValue0
      })
      if (DATA1) {
        ARRAY1.push({
          x: tmpTimestamp,
          y: plotValue1
        })
      }
      if (DATA2) {
        ARRAY2.push({
          x: tmpTimestamp,
          y: plotValue2
        })
      }
    }
  }
  var stream = [
    { name: 'Wind Speed', 
      lineWidth: 2,
      data: ARRAY0, yAxis : '0' }, 
    { name: 'Gust', 
      type: 'line',
      lineWidth: 0,
      states: { 
    	  hover: {
      	  lineWidthPlus: 0
        }
      },
      marker: {
        radius: 2,
        symbol: 'circle',
        enabled: true
      },
      data: ARRAY1, yAxis : '0' }, 
    { name: 'Direction', 
      color: '#25c63e', 
      type: 'line',
      lineWidth: 0,
      states: { 
    	  hover: {
      	  lineWidthPlus: 0
        }
      },
      marker: {
        radius: 2,
        symbol: 'circle',
        enabled: true
      },
      data: ARRAY2, yAxis : '1'  }
  ];
  Highcharts.setOptions({
    time: {
      timezone: TIMEZONE
    }
  });
  $('#container').highcharts({
    title: {
      text:'' 
    },
    subtitle: {
      text: 'Desktop users: Click and drag in the plot area to zoom in<br>Mobile users: Pinch the chart to zoom in<br>Zooming in will divulge wind direction'
    },
    chart: {
      zoomType: 'xy'
    },
    xAxis: {
      alternateGridColor: '#f4f0ec',
      type: 'datetime',
      minPadding: 0.1,
      maxPadding: 0.1,
      tickInterval: 6 * 3600 * 1000
    },
    yAxis: [{
      id: '0',
      min: 0,
      title: {
        text: 'Wind Speed and Gusts',
        style: {
        color: Highcharts.getOptions().colors[0]
        }
      },
      labels: {
            style: {
                color: Highcharts.getOptions().colors[0]
            }
        }
    }, {
      id: '1',
      min: 0,
      max: 360,
      tickInterval: 90,
      opposite: true,
      visible: true,
      title: {
        text: 'Wind Direction',
        style: {
        color: '#25c63e'
        }
      },
      labels: {
            style: {
                color: '#25c63e'
            }
        }
    }],
    plotOptions: {
        series: {
            pointWidth: 1
        }
    },
    tooltip: {
        xDateFormat: '%b %d, %l:%M %p',
        split: true,
        distance: 30,
        padding: 5
    },
    series: stream
  })
}

function makeBarChart(TIME,DATA,LABEL,units,TIMEZONE,SITE,network,SLP) {
  $('#container').show();
  var MEAS = '';
  if (units == 'english_k') {
    units = 'english';
  }
  if (units =='english') {
    MEAS = ' (in)';
  } else {
    MEAS = ' (mm)';
  }
  if (SLP) {
    SLP = SLP.split(',');
  }
  var ARRAY = [];
  TIME = TIME.split(',');
  DATA = DATA.split(',');
  var T0 = TIME[0].substr(0,4)+TIME[0].substr(5,2)+TIME[0].substr(8,2)+TIME[0].substr(11,2)+TIME[0].substr(14,2); 
  $.getJSON('https://api.synopticdata.com/v2/stations/precip?stid='+SITE+'&start='+T0+'&end=210001010000&pmode=totals&complete=1&token='+mesoToken+'&units='+units, function (DATA) {
    var HOWMUCHSINCE = DATA.STATION[0].OBSERVATIONS.precipitation[0].total.toFixed(2);
    $('#TOTAL').show();
    $('#TOTAL').html('<center>Rain totals for the selected period: ' + HOWMUCHSINCE +' '+MEAS.replace('(','').replace(')','')+'</center>');
  });
  var numPoints = TIME.length;
  var rainTotal = parseFloat(0.00);
  var trace = '';
  for (i=0; i < numPoints; i++) {
    var minutes = (moment(TIME[i]).tz(TIMEZONE).format('mm')).toString();
    var tmpTimestamp = parseInt(moment(TIME[i]).format('x'));
    if (units =='metric') {
      var plotValue = DATA[i]*100;
    } else {
      var plotValue = parseFloat(DATA[i]);
    }
    if (network == 'ASOS/AWOS') {
      if (SLP[i] != '') {
        ARRAY.push({
          x: tmpTimestamp,
          y: plotValue
        })
      }
    } else {
      if (DATA[i] > 0) {
        ARRAY.push({
          x: tmpTimestamp,
          y: plotValue
        })
      }
    }
  }
  var stream = [{
    name: LABEL,
    data: ARRAY
  }]
  Highcharts.setOptions({
    time: {
      timezone: TIMEZONE
    }
  });
  $('#container').highcharts({
    title: {
      text: ''
    },
    subtitle: {
      text: 'Desktop users: Click and drag in the plot area to zoom in<br>Mobile users: Pinch the chart to zoom in'
    },
    chart: {
      type: 'column',
      zoomType: 'xy'
    },
    xAxis: {
      type: 'datetime',
      minPadding: 0.1,
      maxPadding: 0.1,
      tickInterval: 1000 * 3600
    },
    yAxis: {
        min: 0,
        title: {
            text: LABEL+' '+MEAS 
        }
    },
    plotOptions: {
        series: {
            pointWidth: 2
        }
    },
    tooltip: {
        xDateFormat: '%b %d, %l:%M %p',
        valueSuffix: ' '+MEAS,
        split: true,
        distance: 30,
        padding: 5
    },
    series: stream
  })
}

function resizePage(fontSize) {
  fontSize = parseInt(fontSize);
  $('#OBS_DATA').css({'font-size': fontSize});
  var DIVWIDTH = $('#OBS_DATA').width();
  if (DIVWIDTH > 960) {
    $('.content').css({'width' : DIVWIDTH , "background-color": "white", "padding-left": 5, "padding-right": 5 });  // Add space from "Customize Your Weather.gov" to full width of page
    $('.center-content').css({'width' : DIVWIDTH , "background-color": "white", "padding-left": 5, "padding-right": 5 });  // Add space from "Customize Your Weather.gov" to full width of page
    DIVWIDTH = DIVWIDTH + 10;
    $('.header-content').css({'width' : DIVWIDTH , "background-color": "white" });
    $('.header-shadow-content').css({'width' : DIVWIDTH });
    $('.footer-legal-content').css({'width' : DIVWIDTH , "background-color": "white" });
  }
}

function readChoices() {
  var siteValue  = $("input[name='SITE']").val();
  var hoursValue = $("#HOURS option:selected").val();
  var unitsValue = $("input[name='UNITS']:checked").val();
  var chartValue = $("input[name='CHART']:checked").val();
  var headValue  = $("input[name='HEADERS']:checked").val();
  var obsValue   = $("input[name='OBS']:checked").val();
  var history    = $("input[name='HISTORY']:checked").val();
  var hourlyVal  = $("input[name='HOURLY']:checked").val();
  var precipVal  = $("input[name='PRECIP']:checked").val();
  var fontVal    = $("#FONT option:selected").val();
  var plot       = $(".perm_select option:selected").val();
  if (history == 'yes') {
    var startValue = $("input[id='STARTDATE']").val().replaceAll('-','');
    var endValue   = $("input[id='ENDDATE']").val().replaceAll('-','');
    if (parseInt(startValue) && parseInt(endValue)) {
      window.location.href = 'https://www.weather.gov/wrh/timeseries?site='+siteValue+'&hours='+hoursValue+'&units='+unitsValue+'&chart='+chartValue+'&headers='+headValue+'&obs='+obsValue+'&hourly='+hourlyVal+'&pview='+precipVal+'&font='+fontVal+'&history=yes&start='+startValue+'&end='+endValue+'&plot='+plot;
    } else {
      alert('Start and/or End Dates not recognized\n Select valid Start and End dates,\n or uncheck the "Gather Historical Data" box.');
    }
  } else {
    window.location.href = 'https://www.weather.gov/wrh/timeseries?site='+siteValue+'&hours='+hoursValue+'&units='+unitsValue+'&chart='+chartValue+'&headers='+headValue+'&obs='+obsValue+'&hourly='+hourlyVal+'&pview='+precipVal+'&font='+fontVal+'&plot='+plot;
  }
}

function buildCustomMenu (SITE,hours,units,format,headers,chart,hourly,history,startValue,endValue,pview,fontSize,plot) {
  $('#STARTDATE').hide();
  $('#ENDDATE').hide();
  var dropDown = '<center><p valign="top"><select name="HOURS">';
  for (i=1; i<721; i++) {
    if (i == hours) {
      dropDown += '<option value="'+i+'" selected>'+i+'</option>';
    } else { 
      dropDown += '<option value="'+i+'">'+i+'</option>';
    }
  }
  $('#HOURS').html(dropDown+'</selct></center> <br>&nbsp; <br>&nbsp;');
  if (units == 'english_k') {
    $(':radio[value=english_k]').prop('checked',true); 
  }
  if (units == 'metric') {
    $(':radio[value=metric]').prop('checked',true); 
  }
  if (headers == 'min') {
    $(':radio[value=min]').prop('checked',true); 
  }
  if (headers == 'none') {
    $(':radio[value=none]').prop('checked',true); 
  }
  if (chart == 'off') {
    $(':radio[value=off]').prop('checked',true); 
  }
  if (format == 'raw') {
    $(':radio[value=raw]').prop('checked',true); 
  }
  if (hourly == 'true') {
    $(':radio[value=true]').prop('checked',true);
  }
  if (pview == 'full') {
    $(':radio[value=full]').prop('checked',true);
  }
  if (pview == 'measured') {
    $(':radio[value=measured]').prop('checked',true);
  }
  var fontDropDown = '<center><p valign="top"><select name="FONT">';
  for (j=8; j<31; j++) {
    if (j == fontSize) {
      fontDropDown += '<option value="'+j+'" selected>'+j+'</option>';
    } else {
      fontDropDown += '<option value="'+j+'">'+j+'</option>';
    }
  }
  $('#FONT').html(fontDropDown+'</selct></center> <br>&nbsp; <br>&nbsp;');

  if (history == 'yes') {
    $('#HISTORY').prop('checked', true);   
    $('#STARTDATE').prop('value',startValue.substr(0,4)+'-'+startValue.substr(4,2)+'-'+startValue.substr(6,2));
    $('#ENDDATE').prop('value',endValue.substr(0,4)+'-'+endValue.substr(4,2)+'-'+endValue.substr(6,2));
    $('#STARTDATE').show(); 
    $('#ENDDATE').show(); 
  }   
}

function getCalYearPrecip(SITE,units,T0) {
  var d = new Date();
  var year = moment(d).format('YYYY');
// .getFullYear();
  if (units == 'english_k') {
    units = 'english'
  }
  if (T0) {
    // For the top of the bar chart, when selected
    $.getJSON('https://api.synopticdata.com/v2/stations/precip?stid='+SITE+'&start='+T0+'&end=210001010000&pmode=totals&complete=1&token='+mesoToken+'&units='+units, function (DATA) {
      var VALUE = DATA.STATION[0].OBSERVATIONS.precipitation[0].total.toFixed(2);
      return VALUE;
    });
 } else {  
    $.getJSON('https://api.synopticdata.com/v2/stations/precip?stid='+SITE+'&start='+year+'01010000&end=210001010000&pmode=totals&complete=1&token='+mesoToken+'&units='+units, function (DATA) {
      if (DATA.STATION[0]) {
        var VALUE = DATA.STATION[0].OBSERVATIONS.precipitation[0].total.toFixed(2);
        $('#CAL_YEAR').html('<font color="green">Current calendar year total (since January 1, '+year+'): ' +VALUE +' '+ DATA.UNITS.precipitation.toLowerCase()+'</font>');
      } else {
        $('#CAL_YEAR').html('<font color="black">Data not available at this location.</font>');
      }
    }) 
  }
}

function getH2OYearPrecip(SITE,units) {
  if (units == 'english_k') {
    units = 'english'
  }
  var d = new Date();
  var year = moment(d).format('YYYY');
  var month = parseInt(moment(d).format('M'));
  if (month < 10) {
    year = parseInt(year) - 1;
  }
  console.log('https://api.synopticdata.com/v2/stations/precip?stid='+SITE+'&start='+year+'10010000&end=210001010000&pmode=totals&complete=1&token='+mesoToken+'&units='+units);
  $.getJSON('https://api.synopticdata.com/v2/stations/precip?stid='+SITE+'&start='+year+'10010000&end=210001010000&pmode=totals&complete=1&token='+mesoToken+'&units='+units, function (DATA) {
    if (DATA.STATION[0]) {
      var VALUE = DATA.STATION[0].OBSERVATIONS.precipitation[0].total.toFixed(2);
      $('#H2O_YEAR').html('<font color="green">Current water year total (since October 1, '+year+'): ' +VALUE +' '+ DATA.UNITS.precipitation.toLowerCase()+'</font>');
    } else {
      $('#H2O_YEAR').html('<font color="black">Data not available at this location.</font>');
    }
  }) 
}

function getDerivedSnow (interval,position,stamps,dataset) {
  var plusone   = position + 1;
  var timeStamp = stamps[position];
  var dataValue = dataset[position];
  var epochTime = new Date(timeStamp).getTime();
  var INT = interval * 60 * 1000;
  var change = '--';
  for (i=0; i < plusone; i++) {
    var testStamp = new Date(stamps[i]).getTime();
    var math = epochTime - testStamp;
    if (math == INT) {
      change = parseFloat(dataValue).toFixed(1) - parseFloat(dataset[i]).toFixed(1);
      if (change < 0) {      
        change = 0;
      }
      return change.toFixed(1);
    }  
  }
} 

function getDerivedPrecip (interval,position,stamps,dataset) {
  var plusone   = position + 1;
  var timeStamp = stamps[position];
  var dataValue = dataset[position];
  var epochTime = new Date(timeStamp).getTime();
  var INT = interval * 60 * 1000;
  var change = '--';
  for (i=0; i < plusone; i++) {
    var testStamp = new Date(stamps[i]).getTime();
    var math = epochTime - testStamp;
    if (math == INT) {
      change = dataValue - dataset[i]
      if (change < 0) {      
        change = '0.00';
      }
      change = parseFloat(change).toFixed(2);
    }  
  }
  return change;
} 

function calcIncrementalPrecip (interval,position,stamps,dataset) {
  var plusone   = position + 1;
  var timeStamp = stamps[position];
  var maxStamp  = new Date(timeStamp).getTime();
  var maxTime   = interval * 60 * 1000;
  var total = 0.00;
  for (i=0; i < plusone; i++) {
    var testStamp = new Date(stamps[i]).getTime();
    var diff = maxStamp - testStamp;
    if (diff < maxTime) {
      total = total + dataset[i];
    }
  }
  return parseFloat(total).toFixed(2); 
}

function calcStationP(pressure,elevation) {
  var el_M = elevation * 0.3048;
  var stationP = (288 - (0.0065 * el_M))
      stationP = stationP/288;
      stationP = Math.pow(stationP,5.2561);
      stationP = pressure * stationP;
      stationP = (Math.round(100*stationP)/100).toFixed(2);
  return stationP;
}

