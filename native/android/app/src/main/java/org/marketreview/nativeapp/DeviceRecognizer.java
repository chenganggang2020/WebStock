package org.marketreview.nativeapp;

import android.media.*;
import android.os.SystemClock;
import java.io.*;
import java.nio.*;
import java.time.Instant;
import org.json.*;
import org.vosk.Model;
import org.vosk.Recognizer;

/** Streaming platform decoder + local Vosk. No microphone permission, networking or desktop RPC. */
final class DeviceRecognizer {
  interface Progress {
    void update(String text);
  }
  static void interrupted() throws InterruptedIOException {
    if (Thread.currentThread().isInterrupted())
      throw new InterruptedIOException("任务已停止");
  }
  static short[] mono(ByteBuffer input, int channels, int encoding) throws IOException {
    int bytes = encoding == AudioFormat.ENCODING_PCM_16BIT ? 2
        : encoding == AudioFormat.ENCODING_PCM_FLOAT       ? 4
                                                           : 0;
    if (channels < 1 || channels > 8 || bytes == 0 || input.remaining() % (bytes * channels) != 0)
      throw new IOException("不支持或不完整的音频采样格式");
    input.order(ByteOrder.LITTLE_ENDIAN);
    short[] out = new short[input.remaining() / (bytes * channels)];
    for (int n = 0; n < out.length; n++) {
      double sum = 0;
      for (int c = 0; c < channels; c++) {
        double sample = bytes == 2 ? input.getShort() : input.getFloat() * 32768.0;
        if (!Double.isFinite(sample))
          throw new IOException("音频包含非有限采样值");
        sum += sample;
      }
      out[n] = (short) Math.max(-32768, Math.min(32767, Math.round(sum / channels)));
    }
    return out;
  }
  static void append(JSONArray segments, StringBuilder text, String raw, double offset)
      throws Exception {
    JSONObject result = new JSONObject(raw);
    String value = result.optString("text").trim();
    if (value.isEmpty())
      return;
    JSONArray words = result.optJSONArray("result");
    if (words == null || words.length() == 0)
      throw new IOException("识别结果缺少时间戳");
    for (int n = 0; n < words.length(); n++) {
      JSONObject word = words.getJSONObject(n);
      double start = word.getDouble("start") + offset, end = word.getDouble("end") + offset;
      if (!Double.isFinite(start) || !Double.isFinite(end) || end < start || start < 0)
        throw new IOException("识别时间戳无效");
      word.put("start", start).put("end", end);
    }
    segments.put(new JSONObject()
            .put("text", value)
            .put("words", words)
            .put("start", words.getJSONObject(0).getDouble("start"))
            .put("end", words.getJSONObject(words.length() - 1).getDouble("end")));
    if (text.length() > 0)
      text.append('\n');
    text.append(value);
    if (text.length() > 600000)
      throw new IOException("识别文稿超过60万字");
  }
  static JSONObject recognize(File media, File model, Progress progress) throws Exception {
    interrupted();
    if (!media.isFile() || media.length() == 0 || media.length() > 256L * 1024 * 1024)
      throw new IOException("本机媒体不存在、为空或超过256MB");
    MediaExtractor extractor = new MediaExtractor();
    MediaCodec codec = null;
    Recognizer recognizer = null;
    try (Model local = new Model(model.getAbsolutePath())) {
      extractor.setDataSource(media.getAbsolutePath());
      MediaFormat format = null;
      for (int i = 0; i < extractor.getTrackCount(); i++) {
        MediaFormat candidate = extractor.getTrackFormat(i);
        if (candidate.getString(MediaFormat.KEY_MIME).startsWith("audio/")) {
          extractor.selectTrack(i);
          format = candidate;
          break;
        }
      }
      if (format == null)
        throw new IOException("媒体没有可解码的音轨");
      long duration = format.containsKey(MediaFormat.KEY_DURATION)
          ? format.getLong(MediaFormat.KEY_DURATION)
          : 0;
      if (duration > 2L * 60 * 60 * 1000000)
        throw new IOException("当前手机单次支持不超过2小时的媒体");
      codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
      codec.configure(format, null, null, 0);
      codec.start();
      MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
      boolean inputEnd = false, outputEnd = false;
      int sampleRate = 0, channels = 0, encoding = AudioFormat.ENCODING_PCM_16BIT;
      long decoded = 0, lastProgress = 0, started = SystemClock.elapsedRealtime(),
           lastOutput = started;
      double offset = -1;
      JSONArray segments = new JSONArray();
      StringBuilder text = new StringBuilder();
      while (!outputEnd) {
        interrupted();
        long now = SystemClock.elapsedRealtime();
        if (now - started > 60L * 60 * 1000 || now - lastOutput > 60000)
          throw new IOException("解码或识别超时，已保留旧媒体和文稿");
        if (!inputEnd) {
          int index = codec.dequeueInputBuffer(10000);
          if (index >= 0) {
            ByteBuffer input = codec.getInputBuffer(index);
            if (input == null)
              throw new IOException("解码器没有输入缓冲");
            int size = extractor.readSampleData(input, 0);
            if (size < 0) {
              codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
              inputEnd = true;
            } else {
              codec.queueInputBuffer(index, 0, size, extractor.getSampleTime(), 0);
              extractor.advance();
            }
          }
        }
        int index = codec.dequeueOutputBuffer(info, 10000);
        if (index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          MediaFormat out = codec.getOutputFormat();
          int rate = out.getInteger(MediaFormat.KEY_SAMPLE_RATE);
          if (rate < 8000 || rate > 96000 || (sampleRate != 0 && rate != sampleRate))
            throw new IOException("音轨采样率不支持或在中途变化");
          sampleRate = rate;
          channels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
          encoding = out.containsKey(MediaFormat.KEY_PCM_ENCODING)
              ? out.getInteger(MediaFormat.KEY_PCM_ENCODING)
              : AudioFormat.ENCODING_PCM_16BIT;
          if (recognizer == null) {
            recognizer = new Recognizer(local, sampleRate);
            recognizer.setWords(true);
          }
        } else if (index >= 0) {
          try {
            if (info.size > 0 && (info.flags & MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
              if (recognizer == null)
                throw new IOException("解码器未提供音频格式");
              ByteBuffer out = codec.getOutputBuffer(index);
              if (out == null)
                throw new IOException("解码器没有音频输出");
              out.position(info.offset);
              out.limit(info.offset + info.size);
              short[] samples = mono(out, channels, encoding);
              if (offset < 0)
                offset = Math.max(0, info.presentationTimeUs / 1000000.0);
              double expected = offset + decoded / (double) sampleRate;
              if (Math.abs(info.presentationTimeUs / 1000000.0 - expected) > .15)
                throw new IOException("音轨时间不连续；停止识别以避免错误时间戳");
              if (recognizer.acceptWaveForm(samples, samples.length))
                append(segments, text, recognizer.getResult(), offset);
              decoded += samples.length;
              lastOutput = SystemClock.elapsedRealtime();
              if (decoded / (double) sampleRate > 7200)
                throw new IOException("音轨超过2小时");
              if (lastOutput - lastProgress > 1500) {
                progress.update(
                    "手机离线识别 " + (decoded / sampleRate) + " 秒音频；切换子页可继续");
                lastProgress = lastOutput;
              }
            }
            outputEnd = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
          } finally {
            codec.releaseOutputBuffer(index, false);
          }
        }
      }
      interrupted();
      if (recognizer == null || decoded == 0)
        throw new IOException("未解码到音频");
      append(segments, text, recognizer.getFinalResult(), Math.max(0, offset));
      if (text.length() == 0)
        throw new IOException("未识别到语音，不生成空文稿");
      return new JSONObject()
          .put("text", text.toString())
          .put("segments", segments)
          .put("engine", "vosk-android-0.3.75")
          .put("model", "vosk-model-small-cn-0.22")
          .put("deviceLocal", true)
          .put("sourceSampleRate", sampleRate)
          .put("sourceChannels", channels)
          .put("decodedSeconds", decoded / (double) sampleRate)
          .put("audioOffsetSeconds", offset)
          .put("createdAt", Instant.now().toString())
          .put("verification", "unverified");
    } finally {
      if (recognizer != null)
        recognizer.close();
      if (codec != null) {
        try {
          codec.stop();
        } catch (Exception ignored) {
        }
        codec.release();
      }
      extractor.release();
    }
  }
}
