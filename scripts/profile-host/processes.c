/* Development fixture only. No installed runtime invokes a compiler. */
#include <sys/types.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <unistd.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <time.h>
static pid_t children[32];
static int count;
static volatile sig_atomic_t stopped;
static void stop(int sig) {
  stopped = 1;
  for (int i = 0; i < count; i++) if (children[i] > 0) kill(children[i], sig);
}
static long long cpu_us(struct rusage r) {
  return (long long)r.ru_utime.tv_sec * 1000000 + r.ru_utime.tv_usec +
    (long long)r.ru_stime.tv_sec * 1000000 + r.ru_stime.tv_usec;
}
int main(int argc, char **argv) {
  signal(SIGTERM, stop); signal(SIGINT, stop);
  if (argc >= 3 && !strcmp(argv[1], "--cpu")) {
    long ms = strtol(argv[2], NULL, 10); if (ms < 1 || ms > 1000) return 2;
    struct timespec t; clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &t);
    long long start = (long long)t.tv_sec * 1000000000 + t.tv_nsec;
    do { clock_gettime(CLOCK_PROCESS_CPUTIME_ID, &t); }
    while (!stopped && (long long)t.tv_sec * 1000000000 + t.tv_nsec - start < ms * 1000000);
    return 0;
  }
  if (argc >= 3 && !strcmp(argv[1], "--exec")) {
    pid_t pid = fork(); if (pid < 0) return 3;
    if (!pid) { signal(SIGTERM, SIG_DFL); signal(SIGINT, SIG_DFL); execvp(argv[2], argv + 2); _exit(127); }
    children[count++] = pid;
    struct rusage usage, own; int status;
    while (wait4(pid, &status, 0, &usage) < 0) if (errno != EINTR) return 4;
    children[0] = 0; count = 0;
    getrusage(RUSAGE_SELF, &own);
    /* Conservative upper bound includes this measurement wrapper's own peak. */
    long long rss = usage.ru_maxrss + own.ru_maxrss;
#ifndef __APPLE__
    rss *= 1024;
#endif
    fprintf(stderr,"\nHAT_PROFILE_RUSAGE {\"cpuUs\":%lld,\"maxRssBytes\":%lld}\n",cpu_us(usage)+cpu_us(own),rss);
    return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
  }
  if (argc != 2) return 2;
  int requested = atoi(argv[1]); if (requested < 0 || requested > 31) return 2;
  for (int i = 0; i < requested; i++) {
    pid_t pid = fork();
    if (pid < 0) { stop(SIGTERM); goto cleanup; }
    if (!pid) { signal(SIGTERM, SIG_DFL); signal(SIGINT, SIG_DFL); close(0); close(1); close(2); for (;;) pause(); }
    children[count++] = pid;
  }
  printf("{\"pid\":%d,\"children\":[",getpid());
  for (int i=0;i<count;i++) printf("%s%d",i?",":"",children[i]);
  printf("]}\n"); fflush(stdout);
  char byte;
  while (!stopped) { ssize_t n=read(0,&byte,1);if (!n) break;if(n<0&&errno!=EINTR)break; }
  stop(SIGTERM);
cleanup:
  for (int i=0;i<count;i++) { while(waitpid(children[i],NULL,0)<0 && errno==EINTR) {} children[i]=0; }
  return count == requested ? 0 : 3;
}
