package dev.kaipi.android;

import android.content.Context;
import android.os.Build;
import android.system.Os;
import android.system.ErrnoException;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

/** Owns a local PTY. The reader exclusively reaps the process and closes its descriptor. */
final class LocalTerminal implements AutoCloseable {
    static { System.loadLibrary("kaipi_pty"); }
    interface Listener { void output(byte[] bytes); void status(String message); }
    private final Listener listener;
    private final Object lock = new Object();
    private final Object writeLock = new Object();
    private final ExecutorService writer = Executors.newSingleThreadExecutor();
    private int fd = -1;
    private volatile int pid = -1;
    private volatile boolean closed;
    private volatile Thread reader;
    private int columns=80, lines=24;
    LocalTerminal(Listener listener) {this.listener=listener;}
    void start(Context context, File workspace, int cols, int rows) {
        columns=cols;lines=rows;
        reader = new Thread(() -> {
            try {
                File home = new File(context.getFilesDir(), "home");
                new File(home,"tmp").mkdirs();
                workspace.mkdirs();
                File payload = new File(context.getFilesDir(), "runtime");
                File binary = new File(context.getApplicationInfo().nativeLibraryDir, "libkaipi_python.so");
                if(!binary.isFile())throw new IOException("Missing packaged Python runtime");
                prepareRuntime(context,payload);
                prepareCommands(context,home);
                File main = new File(payload,"main.py");
                if(!main.isFile())throw new IOException("Missing kaipi entry");
                String executable=binary.getAbsolutePath(), entry=main.getAbsolutePath();
                synchronized(lock) {
                    if(closed)return;
                    int[] process=spawn(executable,entry,home.getAbsolutePath(),workspace.getAbsolutePath(),columns,lines);
                    if(process==null)throw new IOException("PTY unavailable");fd=process[0];pid=process[1];
                }
                listener.status("本地运行");
                byte[] data;
                while(!closed && (data=read(fd))!=null)listener.output(data);
            } catch(Exception e) {
                listener.status("启动失败 · "+e.getClass().getSimpleName());
            } finally {
                writer.shutdownNow();
                synchronized(writeLock) { synchronized(lock) {
                    if(pid>0) {
                        stop(pid);
                        int exit=reap(fd,pid);fd=-1;pid=-1;
                        if(!closed)listener.status("会话已结束（"+exit+"）· 可重启");
                    }
                    closed=true;
                }}
            }
        },"kaipi-pty-reader");
        reader.start();
    }
    private static synchronized void prepareRuntime(Context context, File payload) throws IOException {
        File marker=new File(payload,".installed");
        String identity;
        try(InputStream input=context.getAssets().open("runtime-id")) {
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            byte[] buffer=new byte[128];int count;
            while((count=input.read(buffer))!=-1)bytes.write(buffer,0,count);
            identity=bytes.toString("UTF-8");
        }
        if(marker.isFile() && new String(java.nio.file.Files.readAllBytes(marker.toPath()),StandardCharsets.UTF_8).equals(identity))return;
        File staging=new File(payload.getParentFile(),"runtime-staging");
        removeTree(staging);
        copyAssets(context,"runtime",staging);
        copyAssets(context,"runtime-abi/"+Build.SUPPORTED_ABIS[0],staging);
        java.nio.file.Files.write(new File(staging,".installed").toPath(),identity.getBytes(StandardCharsets.UTF_8));
        removeTree(payload);
        if(!staging.renameTo(payload))throw new IOException("Cannot install runtime");
    }
    private static void removeTree(File file) throws IOException {
        File[] children=file.listFiles();
        if(children!=null)for(File child:children)removeTree(child);
        if(file.exists() && !file.delete())throw new IOException("Cannot remove "+file.getName());
    }
    private static synchronized void prepareCommands(Context context, File home) throws IOException {
        File bin=new File(home,"bin");bin.mkdirs();
        for(String[] tool:new String[][]{{"python","libkaipi_python.so"},{"python3","libkaipi_python.so"},{"git","libkaipi_git.so"}}) {
            File link=new File(bin,tool[0]);File target=new File(context.getApplicationInfo().nativeLibraryDir,tool[1]);
            if(!target.isFile())continue;
            try {
                java.nio.file.Files.deleteIfExists(link.toPath());
                Os.symlink(target.getAbsolutePath(),link.getAbsolutePath());
            } catch(ErrnoException e){throw new IOException("Cannot link "+tool[0],e);}
        }
    }
    private static void copyAssets(Context context,String path,File target) throws IOException {
        String[] children=context.getAssets().list(path);
        if(children!=null && children.length>0) {
            if(!target.isDirectory() && !target.mkdirs())throw new IOException("mkdir failed");
            for(String child:children)copyAssets(context,path+"/"+child,new File(target,child));
        } else {
            try(InputStream input=context.getAssets().open(path); OutputStream output=new FileOutputStream(target)) {
                byte[] buffer=new byte[16384];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);
            }
        }
    }
    void send(String text) {
        if(closed)return;
        try {writer.submit(()->{synchronized(writeLock){
            int target; synchronized(lock){if(fd<0 || closed)return;target=fd;}
            if(!write(target,text.getBytes(StandardCharsets.UTF_8)))listener.status("终端写入失败");
        }});}
        catch(RejectedExecutionException ignored){}
    }
    void resize(int cols,int rows) {
        synchronized(lock){columns=Math.max(2,Math.min(cols,1000));lines=Math.max(2,Math.min(rows,1000));if(fd>=0 && !closed)resizeNative(fd,columns,lines);}
    }
    @Override public void close() {
        closed=true;
        // Killing the child unblocks writes; the lifecycle lock prevents a stale-PID kill.
        synchronized(lock){if(pid>0)stop(pid);}
        writer.shutdownNow();
        if(reader!=null)reader.interrupt();
    }
    private static native int[] spawn(String executable,String script,String home,String workspace,int cols,int rows);
    private static native byte[] read(int fd);
    private static native boolean write(int fd,byte[] data);
    private static native void resizeNative(int fd,int cols,int rows);
    private static native void stop(int pid);
    private static native int reap(int fd,int pid);
}
