using System;
using System.Collections.Generic;
using System.Text;
using System.IO;
using System.Threading;
using System.Threading.Tasks;

namespace Guncho
{
    class ReplacingStream : Stream
    {
        private readonly string path;
        private FileStream stream;
        private bool rolledBack, disposed;

        private const string NEW_EXT = ".new";
        private const string OLD_EXT = ".old";

        public ReplacingStream(string path)
        {
            this.path = path;

            stream = new FileStream(path + NEW_EXT, FileMode.Create, FileAccess.Write);
        }

        protected override void Dispose(bool disposing)
        {
            if (!disposed)
            {
                disposed = true;

                if (disposing && stream != null)
                {
                    stream.Dispose();
                    stream = null;
                }

                if (rolledBack)
                {
                    File.Delete(path + NEW_EXT);
                }
                else if (File.Exists(path))
                {
                    File.Move(path, path + OLD_EXT);
                    File.Move(path + NEW_EXT, path);
                    File.Delete(path + OLD_EXT);
                }
                else
                {
                    File.Move(path + NEW_EXT, path);
                }
            }

            base.Dispose(disposing);
        }

        public void Rollback()
        {
            rolledBack = true;
        }

        public override bool CanRead
        {
            get { return stream.CanRead; }
        }

        public override bool CanSeek
        {
            get { return stream.CanSeek; }
        }

        public override bool CanWrite
        {
            get { return stream.CanWrite; }
        }

        public override void Flush()
        {
            stream.Flush();
        }

        public override Task FlushAsync(CancellationToken cancellationToken)
        {
            return stream.FlushAsync(cancellationToken);
        }

        public override long Length
        {
            get { return stream.Length; }
        }

        public override long Position
        {
            get { return stream.Position; }
            set { stream.Position = value; }
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            return stream.Read(buffer, offset, count);
        }

        public override IAsyncResult BeginRead(byte[] buffer, int offset, int count, AsyncCallback callback, object state)
        {
            return stream.BeginRead(buffer, offset, count, callback, state);
        }

        public override int EndRead(IAsyncResult asyncResult)
        {
            return stream.EndRead(asyncResult);
        }

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            return stream.ReadAsync(buffer, offset, count, cancellationToken);
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            return stream.Seek(offset, origin);
        }

        public override void SetLength(long value)
        {
            stream.SetLength(value);
        }

        public override void Write(byte[] buffer, int offset, int count)
        {
            stream.Write(buffer, offset, count);
        }

        public override IAsyncResult BeginWrite(byte[] buffer, int offset, int count, AsyncCallback callback, object state)
        {
            return stream.BeginWrite(buffer, offset, count, callback, state);
        }

        public override void EndWrite(IAsyncResult asyncResult)
        {
            stream.EndWrite(asyncResult);
        }

        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            return stream.WriteAsync(buffer, offset, count, cancellationToken);
        }
    }
}
