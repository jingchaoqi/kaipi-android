package dev.kaipi.android;
import java.nio.charset.StandardCharsets;
public class LocalTerminal {
 static {System.loadLibrary("kaipi_pty");}
 static native int[] spawn(String e,String s,String h,String cwd,int c,int r);
 static native byte[] read(int fd);
 static native boolean write(int fd,byte[] b);
 static native void resizeNative(int fd,int c,int r);
 static native void stop(int pid);
 static native int reap(int fd,int pid);
 public static void main(String[] args) throws Exception {
   int[] p=spawn("/bin/sh","","/tmp","/tmp",80,24);
   if(p==null)throw new AssertionError("spawn");
   resizeNative(p[0],96,30);
   write(p[0],"printf '\\nUTF8_你好\\n'; /bin/stty size; exit 7\n".getBytes(StandardCharsets.UTF_8));
   java.io.ByteArrayOutputStream output=new java.io.ByteArrayOutputStream();byte[] b;
   while((b=read(p[0]))!=null)output.write(b);
   String text=output.toString(StandardCharsets.UTF_8);
   int status=reap(p[0],p[1]);
   if(!text.contains("UTF8_你好")||!text.contains("30 96")||status!=7)throw new AssertionError(text+" exit="+status);
   p=spawn("/bin/sh","","/tmp","/tmp",80,24);stop(p[1]);
   if(reap(p[0],p[1])<128)throw new AssertionError("signal termination");
   int[] first=spawn("/bin/sh","","/tmp","/tmp",80,24);
   int[] second=spawn("/bin/sh","","/tmp","/",80,24);
   stop(first[1]); reap(first[0],first[1]);
   write(second[0],"printf 'SESSION_B_OK\\n'; pwd; exit 0\n".getBytes(StandardCharsets.UTF_8));
   output.reset();while((b=read(second[0]))!=null)output.write(b);
   text=output.toString(StandardCharsets.UTF_8);
   if(reap(second[0],second[1])!=0 || !text.contains("SESSION_B_OK") || !text.contains("\r\n/\r\n"))throw new AssertionError("session isolation: "+text);
   System.out.println("PASS: real PTY spawn, UTF-8 I/O, resize, exit status, termination, independent concurrent sessions");
 }
}
