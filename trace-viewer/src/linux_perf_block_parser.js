
base.require('linux_perf_parser');
base.exportTo('tracing', function() {

  var LinuxPerfParser = tracing.LinuxPerfParser;

  /**
   * Parses linux block trace events.
   * @constructor
   */
  function LinuxPerfBlockParser(importer) {
    LinuxPerfParser.call(this, importer);

    importer.registerEventHandler('ext4_sync_file_enter',
        LinuxPerfBlockParser.prototype.ext4SyncFileEnterEvent.bind(this));
    importer.registerEventHandler('ext4_sync_file_exit',
        LinuxPerfBlockParser.prototype.ext4SyncFileExitEvent.bind(this));
    importer.registerEventHandler('block_rq_issue',
        LinuxPerfBlockParser.prototype.blockRqIssueEvent.bind(this));
    importer.registerEventHandler('block_rq_complete',
        LinuxPerfBlockParser.prototype.blockRqCompleteEvent.bind(this));

	/* workaround for async slices */
    this.asyncSlices = {};
  }

  LinuxPerfBlockParser.prototype = {
    __proto__: LinuxPerfParser.prototype,

    /**
     * Helper to open an async slice.
     */
    openAsyncSlice: function(kthread, key, ts, name) {
      var slice = new tracing.TimelineAsyncSlice('', name,
          tracing.getStringColorId(name), ts);
      slice.startThread = kthread.thread;
      this.asyncSlices[key] = slice;
    },


    /**
     * Helper to close an async slice.
     */
    closeAsyncSlice: function(kthread, key, ts, data) {
      var slice = this.asyncSlices[key];
      if (slice) {
        slice.duration = ts - slice.start;
        slice.args = data;
        slice.endThread = kthread.thread;
        slice.subSlices = [ new tracing.TimelineSlice('', slice.title,
           slice.colorId, slice.start, slice.args, slice.duration) ];
        kthread.thread.asyncSlices.push(slice);
        delete this.asyncSlices[key];
      }
    },

	ext4SyncFileEnterEvent: function(eventName, cpuNumber, pid, ts, eventBase) {
	  var event = /dev (\d+,\d+) ino (\d+) parent (\d+) datasync (\d+)/.exec(eventBase[5]);
	  if (!event)
	    return false;

      var dev = event[1];
	  var inode = event[2];
	  var datasync = event[4] == 1;
      var key = dev + '-' + inode

      var kthread = this.importer.getOrCreateKernelThread('ext4: pid-' + pid, pid, pid);
      this.openAsyncSlice(kthread, key, ts, datasync ? 'fdatasync':'fsync')
      return true;
	},

	ext4SyncFileExitEvent: function(eventName, cpuNumber, pid, ts, eventBase) {
	  var event = /dev (\d+,\d+) ino (\d+) ret (\d+)/.exec(eventBase[5]);
	  if (!event)
	    return false;

      var dev = event[1];
	  var inode = event[2];
	  var error = parseInt(event[3]);

      var key = dev + '-' + inode

      var kthread = this.importer.getOrCreateKernelThread('ext4: pid-' + pid, pid, pid);

	  this.closeAsyncSlice(kthread, key, ts, {
          device: dev,
          inode: inode,
          error: error
      });
      return true;
    },

	blockRqIssueEvent: function(eventName, cpuNumber, pid, ts, eventBase) {
	  var event = /(\d+,\d+) (F)?([DWRN])(F)?(A)?(S)?(M)? \d+ \(.*\) (\d+) \+ (\d+) \[.*\]/.exec(eventBase[5]);
	  if (!event)
	    return false;

      var dev = event[1];
	  var sector = parseInt(event[8]);
	  var numSectors = parseInt(event[9]);
	  var action;
	  switch (event[3]) {
	    case 'D':
		  action = 'Discard';
		  break;
		case 'W':
		  action = 'Write';
		  break;
		case 'R':
		  action = 'Read';
		  break;
		case 'N':
		  action = 'None';
		  break;
		default:
		  action = 'Unknown';
		  break;
	  }

	  if (event[2]) {
	    action += ' flush';
	  }
	  if (event[4] == 'F') {
	    action += ' fua';
	  }
	  if (event[5] == 'A') {
	    action += ' ahead';
	  }
	  if (event[6] == 'S') {
	    action += ' sync';
	  }
	  if (event[7] == 'M') {
	    action += ' meta';
	  }

      var key = dev + '-' + sector + '-' + numSectors;
      var kthread = this.importer.getOrCreateKernelThread('block: pid-' + pid, pid, pid);
      this.openAsyncSlice(kthread, key, ts, action);

      return true;
	},

	blockRqCompleteEvent: function(eventName, cpuNumber, pid, ts, eventBase) {
	  var event = /(\d+,\d+) (F)?([DWRN])(F)?(A)?(S)?(M)? \(.*\) (\d+) \+ (\d+) \[(.*)\]/.exec(eventBase[5]);
	  if (!event)
	    return false;

      var dev = event[1];
	  var sector = parseInt(event[8]);
	  var numSectors = parseInt(event[9]);
	  var error = parseInt(event[10]);

      var key = dev + '-' + sector + '-' + numSectors;
      var kthread = this.importer.getOrCreateKernelThread('block: pid-' + pid, pid, pid);

	  this.closeAsyncSlice(kthread, key, ts, {
          device: dev,
          sector: sector,
          numSectors: numSectors,
          error: error
      });

	  return true;
	}
  };

  LinuxPerfParser.registerSubtype(LinuxPerfBlockParser);

  return {
    LinuxPerfBlockParser: LinuxPerfBlockParser
  };
});
