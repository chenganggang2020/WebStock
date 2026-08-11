# Third-Party Notices

## MASTER: Market-Guided Stock Transformer

The design of `quant/webstock_quant/master_model.py` is informed by the official MASTER paper and source repository:

- https://github.com/SJTU-DMTai/MASTER
- Copyright (c) 2025 Data Management Technology and AI
- License: MIT

The WebStock implementation is adapted to its own immutable dataset, rolling-fold, cost, and result contracts. It does not include an official pretrained checkpoint or claim reproduction of the paper's reported performance.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## faster-whisper and speech runtime dependencies

Local creator-video transcription uses the following projects through the pinned Python runtime:

- faster-whisper 1.2.1: https://github.com/SYSTRAN/faster-whisper (MIT)
- CTranslate2 4.8.1: https://github.com/OpenNMT/CTranslate2 (MIT)
- PyAV 18.0.0: https://github.com/PyAV-Org/PyAV (BSD-3-Clause)

WebStock downloads and caches the selected speech model separately in its mutable data directory; no model checkpoint is embedded in the application source.
