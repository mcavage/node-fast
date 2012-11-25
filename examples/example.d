#!/usr/sbin/dtrace -s
#pragma D option quiet

fast*:::rpc-start
{
	tracker[arg1] = timestamp;
}

fast*:::rpc-done
/tracker[arg1]/
{
	@[copyinstr(arg0)] = quantize(((timestamp - tracker[arg1]) / 1000000));
	tracker[arg1] = 0
}
