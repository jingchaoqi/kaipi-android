#include <jni.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <signal.h>
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <string>

static std::string stringValue(JNIEnv* env, jstring value) {
    const char* chars = env->GetStringUTFChars(value, nullptr);
    std::string result(chars); env->ReleaseStringUTFChars(value, chars); return result;
}
extern "C" JNIEXPORT jintArray JNICALL
Java_dev_kaipi_android_LocalTerminal_spawn(JNIEnv* env, jclass, jstring executable, jstring script, jstring directory, jstring workspace, jint cols, jint rows) {
    auto exe = stringValue(env, executable), entry = stringValue(env, script), home = stringValue(env, directory), cwd = stringValue(env, workspace);
    int master = open("/dev/ptmx", O_RDWR | O_CLOEXEC);
    if (master < 0) return nullptr;
    int unlock = 0, number = 0;
    if (ioctl(master, TIOCSPTLCK, &unlock) || ioctl(master, TIOCGPTN, &number)) { close(master); return nullptr; }
    char path[64]; snprintf(path, sizeof(path), "/dev/pts/%d", number);
    int slave = open(path, O_RDWR | O_NOCTTY | O_CLOEXEC);
    if (slave < 0) { close(master); return nullptr; }
    winsize size{}; size.ws_col = cols; size.ws_row = rows;
    ioctl(slave, TIOCSWINSZ, &size);
    // Prepare all allocations before fork; the child of the JVM only uses async-safe calls.
    std::string homeEnv = "HOME=" + home;
    std::string tmpEnv = "TMPDIR=" + home + "/tmp";
    std::string pythonEnv = "PYTHONHOME=" + entry.substr(0, entry.find_last_of('/')) + "/python";
    std::string libraries = "LD_LIBRARY_PATH=" + exe.substr(0, exe.find_last_of('/'));
    std::string search = "PATH=" + home + "/bin:/system/bin";
    char term[]="TERM=xterm-256color", lang[]="LANG=C.UTF-8", color[]="COLORTERM=truecolor";
    char* environment[] = {homeEnv.data(),tmpEnv.data(),pythonEnv.data(),libraries.data(),term,lang,color,search.data(),nullptr};
    char interactive[]="-i";
    char* args[] = {exe.data(),entry.empty()?interactive:entry.data(),nullptr};
    pid_t pid = fork();
    if (pid == 0) {
        close(master); setsid(); ioctl(slave, TIOCSCTTY, 0);
        dup2(slave, 0); dup2(slave, 1); dup2(slave, 2); if (slave > 2) close(slave);
        if (chdir(cwd.c_str()) == -1) _exit(126);
        execve(exe.c_str(), args, environment);
        const char error[]="\r\n无法启动内置运行时。\r\n"; write(2,error,sizeof(error)-1); _exit(127);
    }
    close(slave);
    if (pid < 0) {close(master);return nullptr;}
    jint values[] = {master,pid}; jintArray result=env->NewIntArray(2); env->SetIntArrayRegion(result,0,2,values); return result;
}
extern "C" JNIEXPORT jbyteArray JNICALL
Java_dev_kaipi_android_LocalTerminal_read(JNIEnv* env,jclass,jint fd) {
    char buffer[8192]; ssize_t count;
    do {count=::read(fd,buffer,sizeof(buffer));} while(count<0 && errno==EINTR);
    if(count<=0)return nullptr;
    auto result=env->NewByteArray(count);env->SetByteArrayRegion(result,0,count,reinterpret_cast<jbyte*>(buffer));return result;
}
extern "C" JNIEXPORT jboolean JNICALL
Java_dev_kaipi_android_LocalTerminal_write(JNIEnv* env,jclass,jint fd,jbyteArray data) {
    auto count=env->GetArrayLength(data); auto bytes=env->GetByteArrayElements(data,nullptr);
    ssize_t offset=0;
    while(offset<count) {ssize_t n=::write(fd,bytes+offset,count-offset);if(n<0 && errno==EINTR)continue;if(n<=0)break;offset+=n;}
    env->ReleaseByteArrayElements(data,bytes,JNI_ABORT);return offset==count;
}
extern "C" JNIEXPORT void JNICALL
Java_dev_kaipi_android_LocalTerminal_resizeNative(JNIEnv*,jclass,jint fd,jint cols,jint rows) {
    winsize size{};size.ws_col=cols;size.ws_row=rows;ioctl(fd,TIOCSWINSZ,&size);
}
extern "C" JNIEXPORT void JNICALL
Java_dev_kaipi_android_LocalTerminal_stop(JNIEnv*,jclass,jint pid) {kill(-pid,SIGKILL);kill(pid,SIGKILL);}
extern "C" JNIEXPORT jint JNICALL
Java_dev_kaipi_android_LocalTerminal_reap(JNIEnv*,jclass,jint fd,jint pid) {
    int status=0;close(fd);while(waitpid(pid,&status,0)<0 && errno==EINTR){} return WIFEXITED(status)?WEXITSTATUS(status):128+WTERMSIG(status);
}
