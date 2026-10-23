# 0.37 root集成与集中验证

接入G02账户参考模型/页7个原生文件及双端主机；接入归档视频8个原生文件与主机、生命周期。root独占共享入口/设备/构建；子窗口保持新staging。
G02继承旧未清仓当日参考范围与简单成本比例。未提供ledgerCompleteThroughDate，缺失/旧时点不补0。当前账户与流水分次本机读取，不宣称外部并发写入下的跨读事务快照；后续同事务读取在v40草稿。
视频本机归档长度/SHA/目录/同记录版本核验，播放器同版本再检。QtFILE_SHARE_READ持锁后二次核验；安卓同FD核验再交播放器。没有网络播放/自动播放/ASR对应关系伪证明。
根修：Windows MF时长实际VT_UI8，兼容I8/UI8；Qt错误码可读。Android SEEK_CLOSEST及完成回调、实际源宽高保持比例、按父测量尺寸设置视频。原Qt offscreen没有有效原生视频HWND，报MF_E_CANNOT_CREATE_SINK；真实windows隔离测试正常，不通过更改解码保护绕过。
微软原始时长合同：https://learn.microsoft.com/en-us/windows/win32/medfound/how-to-get-the-playback-duration 。SDK mfplay.h确认MFP_POSITIONTYPE_100NS为空GUID。MFPlay属旧系统API，Windows10/11本机兼容性通过不承诺未来系统。
检查增量：G02初轮Qt3/Android15；视频Android22与Qt3（其中init/cleanup非功能数）。最终build后只重跑这两个受影响宿主，不重跑1604旧核心或旧Qt全套。
视频夹具为已有ffmpeg生成的10秒480×270 H264测试图，无用户媒体。QWidget.grab不含系统视频表面；Qt实际GetPosition/seek与回调验证不可写成视频像素已验。Android实际截图看过3秒且比例正确。
正常生产库/媒体未用作测试；实际平台CDN/ASR时间绑定/ARM与全尺寸最终设计仍未验。最终日志/包hash另在release-verification记录。
