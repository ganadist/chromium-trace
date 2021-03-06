
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

    this.blockSlices = {};
  }

  LinuxPerfBlockParser.prototype = {
    __proto__: LinuxPerfParser.prototype,

    /**
     * Helper to open an slice.
     */
    openBlockSlice: function(group, threadName, pid, key, ts, action) {
      var procName = (/(.+)-\d+/.exec(threadName))[1];
      var kthread = this.importer.getOrCreateKernelThread(procName, pid);
      var slice = new tracing.TimelineAsyncSlice(group, action,
          tracing.getStringColorId(action), ts);
      slice.startThread = kthread.thread;
      this.blockSlices[key] = slice;
    },


    /**
     * Helper to close an slice.
     */
    closeBlockSlice: function(group, key, ts, data) {
      var slice = this.blockSlices[key];
      if (slice) {
        startThread = slice.startThread;
        var kthread = this.importer.getOrCreateKernelThread(startThread.name, startThread.tid);
        slice.duration = ts - slice.start;
        slice.args = data;
        slice.endThread = kthread.thread;
        slice.subSlices = [ new tracing.TimelineSlice(group, slice.title,
           slice.colorId, slice.start, slice.args, slice.duration) ];
        kthread.thread.asyncSlices.push(slice);
        delete this.blockSlices[key];
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

      this.openBlockSlice('ext4', eventBase[1], pid, key, ts, datasync ? 'fdatasync':'fsync')
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
      this.closeBlockSlice('ext4', key, ts, {
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
      this.openBlockSlice('block', eventBase[1], pid, key, ts, action);
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
      this.closeBlockSlice('block', key, ts, {
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
