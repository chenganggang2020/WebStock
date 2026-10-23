#pragma once
#include <QtWidgets>
#include <algorithm>
#include <functional>
#include <stdexcept>

// Private to IndustryDiscoveryPage. The QPlainTextEdit is only a labeled segment;
// callers must use fullText()/fullBytes() for persistence and model input.
class IndustryDiscoveryImportText final : public QWidget {
public:
    static constexpr int SegmentChars = 32768;
    static constexpr int SegmentBytes = 32768;
    static constexpr int MaximumBytes = 8 * 1024 * 1024;
    static constexpr qint64 UndoBudgetBytes = 32 * 1024 * 1024;
    static constexpr int UndoMaximumCommands = 2048;
    std::function<void()> onEdited;
private:
    class View final : public QPlainTextEdit {
    public:
        IndustryDiscoveryImportText* host;
        explicit View(IndustryDiscoveryImportText* p) : QPlainTextEdit(p), host(p) {}
    protected:
        void insertFromMimeData(const QMimeData* mime) override {
            host->insertFromMimeData(mime);
        }
        void keyPressEvent(QKeyEvent* e) override {
            if (e->matches(QKeySequence::Undo)) { host->undoFull(); e->accept(); return; }
            if (e->matches(QKeySequence::Redo)) { host->redoFull(); e->accept(); return; }
            QPlainTextEdit::keyPressEvent(e);
        }
        void inputMethodEvent(QInputMethodEvent* e) override {
            if (!e->commitString().isEmpty() || e->replacementLength()) {
                host->commitInputMethod(e->commitString(), e->replacementStart(), e->replacementLength());
                QInputMethodEvent preedit(e->preeditString(), e->attributes());
                QPlainTextEdit::inputMethodEvent(&preedit);
                e->accept(); return;
            }
            QPlainTextEdit::inputMethodEvent(e);
        }
        void dropEvent(QDropEvent* e) override {
            if (!e->mimeData() || !e->mimeData()->hasText()) { e->ignore(); return; }
            if (host->dropText(e->mimeData()->text(), cursorForPosition(e->position().toPoint()).position(),
                              (e->source() == viewport() || e->source() == this) && e->proposedAction() == Qt::MoveAction))
                e->acceptProposedAction();
            else e->ignore();
        }
        void contextMenuEvent(QContextMenuEvent* e) override {
            QMenu menu(this);
            auto add = [&](QString text, const std::function<void()>& action, bool enabled = true) {
                auto* a = menu.addAction(text); a->setEnabled(enabled);
                connect(a, &QAction::triggered, &menu, action);
            };
            add("撤销", [this] { host->undoFull(); }, host->historyPosition > 0);
            add("重做", [this] { host->redoFull(); }, host->historyPosition < host->history.size());
            menu.addSeparator();
            add("剪切当前选区", [this] { cut(); }, textCursor().hasSelection());
            add("复制当前选区", [this] { copy(); }, textCursor().hasSelection());
            add("粘贴", [this] { paste(); });
            add("全选当前段", [this] { selectAll(); });
            add("复制完整原文", [this] { host->copyFullText(); });
            menu.exec(e->globalPos());
        }
    };
    struct Change { int at; QString removed, added; };
    struct Difference { int at, removed; QString added; };
    View* view;
    QWidget* navigation;
    QLabel* position;
    QPushButton *previous, *next, *last;
    QSpinBox* jump;
    QString whole, shown, rejection;
    QVector<int> starts;
    QVector<Change> history;
    int historyPosition = 0, start = 0, span = 0, pendingCaret = 0;
    qint64 historyBytes = 0;
    bool rendering = false, pendingRender = false, undoTrimmed = false;

    static qint64 storage(const Change& change) {
        return sizeof(Change) + (change.removed.size() + change.added.size()) * qint64(sizeof(QChar));
    }
    static Difference difference(const QString& before, const QString& after) {
        int prefix = 0, suffix = 0;
        while (prefix < before.size() && prefix < after.size() && before[prefix] == after[prefix]) ++prefix;
        if (prefix > 0 && ((prefix < before.size() && before[prefix].isLowSurrogate()) ||
                          (prefix < after.size() && after[prefix].isLowSurrogate()))) --prefix;
        while (suffix < before.size() - prefix && suffix < after.size() - prefix &&
               before[before.size() - suffix - 1] == after[after.size() - suffix - 1]) ++suffix;
        if (suffix > 0 && ((before.size() > suffix && before[before.size() - suffix].isLowSurrogate()) ||
                          (after.size() > suffix && after[after.size() - suffix].isLowSurrogate()))) --suffix;
        return {prefix, int(before.size()) - prefix - suffix, after.mid(prefix, after.size() - prefix - suffix)};
    }

    // Same plain-text conversion as the old Qt 6.9.1 setPlainText/toPlainText
    // path, applied to the entire input independently of which segments are seen.
    static QString plain(QString text) {
        text.replace("\r\n", "\n"); text.replace('\r', '\n');
        for (QChar c : {QChar(0xfdd0), QChar(0xfdd1), QChar(QChar::ParagraphSeparator), QChar(QChar::LineSeparator)})
            text.replace(c, QChar('\n'));
        text.replace(QChar(QChar::Nbsp), QChar(' '));
        return text;
    }
    int safePosition(int at) const {
        at = std::clamp(at, 0, int(whole.size()));
        if (at > 0 && at < whole.size() && whole[at].isLowSurrogate() && whole[at - 1].isHighSurrogate()) --at;
        return at;
    }
    void index() {
        starts = {0}; int bytes = 0, chars = 0;
        const QChar* data = whole.constData();
        for (int i = 0; i < whole.size();) {
            const ushort c = data[i].unicode();
            const bool pair = QChar::isHighSurrogate(c) && i + 1 < whole.size() && data[i + 1].isLowSurrogate();
            const int units = pair ? 2 : 1;
            const int encoded = pair ? 4 : c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
            if (bytes + encoded > SegmentBytes || chars + units > SegmentChars) {
                starts.append(i); bytes = chars = 0;
            }
            bytes += encoded; chars += units; i += units;
        }
        starts.append(whole.size());
        // One empty segment for the empty source, no empty extra final segment.
    }
    int segmentAt(int at) const {
        if (whole.isEmpty()) return 0;
        at = std::clamp(at, 0, int(whole.size()) - 1);
        return std::clamp(int(std::upper_bound(starts.begin(), starts.end(), at) - starts.begin()) - 1,
                          0, segmentCount() - 1);
    }
    void project(int segment, int caret = -1) {
        pendingRender = false;
        segment = std::clamp(segment, 0, segmentCount() - 1);
        start = starts[segment]; span = starts[segment + 1] - start;
        shown = whole.mid(start, span);
        rendering = true;
        { QSignalBlocker block(view); view->setPlainText(shown); }
        if (caret >= 0) {
            auto cursor = view->textCursor(); cursor.setPosition(std::clamp(safePosition(caret) - start, 0, span));
            view->setTextCursor(cursor);
        }
        rendering = false;
        QSignalBlocker block(jump);
        jump->setRange(1, segmentCount()); jump->setValue(segment + 1);
        previous->setEnabled(segment > 0); next->setEnabled(segment + 1 < segmentCount());
        last->setEnabled(segment + 1 < segmentCount());
        navigation->setVisible(segmentCount() > 1);
        const QString undoNotice = undoTrimmed ? QString("较早撤销记录已释放（最多32MiB或2048条）；完整原文仍保留。 ") : QString();
        position->setText(rejection + undoNotice + QString("第 %1/%2 段 · 文本位置 %3–%4 / 共 %5；预览、保存及全文复制均使用完整原文。选区和全选仅作用于当前段。")
                          .arg(segment + 1).arg(segmentCount()).arg(whole.isEmpty() ? 0 : start + 1).arg(start + span).arg(whole.size()));
    }
    void changed() {
        if (rendering) return;
        const QString now = view->toPlainText();
        if (now == shown) return;
        const auto delta = difference(shown, now);
        const int caret = start + view->textCursor().position();
        if (!replace(start + delta.at, delta.removed, delta.added, false)) {
            pendingCaret = start;
        } else { span = now.size(); shown = now; pendingCaret = caret; }
        if (!pendingRender) {
            pendingRender = true;
            // Wait for the native key/cut operation to finish before resetting its document.
            QTimer::singleShot(0, this, [this] { flushProjection(); });
        }
    }
    bool replace(int at, int length, QString added, bool display = true) {
        at = safePosition(at); length = std::clamp(length, 0, int(whole.size()) - at);
        const int end = safePosition(at + length); length = end - at;
        added = plain(std::move(added));
        if (!length && added.isEmpty()) return true;
        QString updated = whole; updated.replace(at, length, added);
        if (updated.toUtf8().size() > MaximumBytes) {
            rejection = "完整原文超过 8MiB，本次编辑未应用；原文仍保留。 ";
            position->setText(rejection); return false;
        }
        rejection.clear();
        for (int i = historyPosition; i < history.size(); ++i) historyBytes -= storage(history[i]);
        history.resize(historyPosition);
        history.append({at, whole.mid(at, length), added}); ++historyPosition;
        historyBytes += storage(history.last());
        while (historyBytes > UndoBudgetBytes || history.size() > UndoMaximumCommands) {
            historyBytes -= storage(history.first()); history.removeFirst(); --historyPosition; undoTrimmed = true;
        }
        whole = std::move(updated); index();
        if (onEdited) onEdited();
        if (display) project(segmentAt(at + added.size()), at + added.size());
        return true;
    }
    void commitInputMethod(QString commit, int replacementStart, int replacementLength) {
        flushProjection();
        auto cursor = view->textCursor();
        QString local = shown;
        int at = cursor.selectionStart();
        local.remove(at, cursor.selectionEnd() - at);
        at = std::clamp(at + replacementStart, 0, int(local.size()));
        const int removed = std::clamp(replacementLength, 0, int(local.size()) - at);
        commit = plain(std::move(commit));
        local.replace(at, removed, commit);
        const auto delta = difference(shown, local);
        const int caret = start + at + commit.size();
        if (replace(start + delta.at, delta.removed, delta.added, false)) project(segmentAt(caret), caret);
    }
    bool dropText(QString text, int at, bool moveWithin) {
        flushProjection();
        if (moveWithin) {
            const auto cursor = view->textCursor();
            const int begin = cursor.selectionStart(), end = cursor.selectionEnd();
            if (at >= begin && at <= end) return true;
            QString local = shown; const QString selected = local.mid(begin, end - begin);
            local.remove(begin, end - begin);
            if (at > end) at -= end - begin;
            local.insert(at, selected);
            const auto delta = difference(shown, local);
            const int caret = start + at + selected.size();
            const bool accepted = replace(start + delta.at, delta.removed, delta.added, false);
            if (accepted) project(segmentAt(caret), caret);
            return accepted;
        } else { return replace(start + std::clamp(at, 0, span), 0, std::move(text)); }
    }
public:
    explicit IndustryDiscoveryImportText(QWidget* parent = nullptr) : QWidget(parent) {
        auto* layout = new QVBoxLayout(this); layout->setContentsMargins(0, 0, 0, 0);
        navigation = new QWidget(this); auto* bar = new QHBoxLayout(navigation); bar->setContentsMargins(0, 0, 0, 0);
        previous = new QPushButton("上一段", navigation); previous->setObjectName("discoveryImportPrevious");
        next = new QPushButton("下一段", navigation); next->setObjectName("discoveryImportNext");
        last = new QPushButton("末段", navigation); last->setObjectName("discoveryImportLast");
        jump = new QSpinBox(navigation); jump->setObjectName("discoveryImportSegment"); jump->setPrefix("转到段 ");
        auto* copy = new QPushButton("复制全文", navigation); copy->setObjectName("discoveryImportCopyFull");
        bar->addWidget(previous); bar->addWidget(next); bar->addWidget(last); bar->addWidget(jump); bar->addWidget(copy); bar->addStretch();
        layout->addWidget(navigation);
        position = new QLabel(this); position->setObjectName("discoveryImportPosition");
        position->setTextFormat(Qt::PlainText); position->setWordWrap(true); layout->addWidget(position);
        view = new View(this); view->setObjectName("discoveryImportText"); view->setLineWrapMode(QPlainTextEdit::NoWrap);
        // This page owns complete-source undo; the projected Qt document is disposable.
        view->setUndoRedoEnabled(false);
        view->setToolTip("这里编辑当前段；上一段、下一段和末段可访问全部原文。复制全文使用上方按钮或右键菜单。");
        layout->addWidget(view, 1);
        connect(view, &QPlainTextEdit::textChanged, this, [this] { changed(); });
        connect(previous, &QPushButton::clicked, this, [this] { showSegment(segmentAt(start) - 1); });
        connect(next, &QPushButton::clicked, this, [this] { showSegment(segmentAt(start) + 1); });
        connect(last, &QPushButton::clicked, this, [this] { showSegment(segmentCount() - 1); });
        connect(jump, &QSpinBox::valueChanged, this, [this](int n) { showSegment(n - 1); });
        connect(copy, &QPushButton::clicked, this, [this] { copyFullText(); });
        index(); project(0);
    }
    QPlainTextEdit* editor() const { return view; }
    QString fullText() const { return whole; }
    QByteArray fullBytes() const { return whole.toUtf8(); }
    qint64 undoStorageBytes() const { return historyBytes; }
    int segmentCount() const { return starts.size() - 1; }
    void setFullText(QString text) {
        text = plain(std::move(text));
        if (text.toUtf8().size() > MaximumBytes) throw std::runtime_error("完整导入原文超过8MiB，未截断");
        whole = std::move(text); rejection.clear(); history.clear(); historyPosition = 0;
        historyBytes = 0; undoTrimmed = false; index(); project(0);
    }
    void flushProjection() {
        if (pendingRender) project(segmentAt(pendingCaret), pendingCaret);
    }
    void showSegment(int n) { flushProjection(); project(n); }
    void selectFullRange(int at, int length) {
        flushProjection(); at = safePosition(at); project(segmentAt(at), at);
        auto cursor = view->textCursor(); cursor.setPosition(at - start);
        cursor.setPosition(std::clamp(safePosition(at + length) - start, 0, span), QTextCursor::KeepAnchor);
        view->setTextCursor(cursor);
    }
    void insertText(QString text) {
        flushProjection(); const auto cursor = view->textCursor();
        replace(start + cursor.selectionStart(), cursor.selectionEnd() - cursor.selectionStart(), std::move(text));
    }
    bool moveSelectionWithinSegment(int position) { return dropText({}, position, true); }
    void undoFull() {
        flushProjection(); if (historyPosition <= 0) return;
        const auto change = history[--historyPosition];
        whole.replace(change.at, change.added.size(), change.removed); rejection.clear(); index();
        project(segmentAt(change.at + change.removed.size()), change.at + change.removed.size());
        if (onEdited) onEdited();
    }
    void redoFull() {
        flushProjection(); if (historyPosition >= history.size()) return;
        const auto change = history[historyPosition++];
        whole.replace(change.at, change.removed.size(), change.added); rejection.clear(); index();
        project(segmentAt(change.at + change.added.size()), change.at + change.added.size());
        if (onEdited) onEdited();
    }
    void insertFromMimeData(const QMimeData* mime) {
        if (mime && mime->hasText()) insertText(mime->text());
    }
    QMimeData* fullTextMimeData() const {
        auto* mime = new QMimeData; mime->setText(whole); return mime;
    }
    void copyFullText() { QApplication::clipboard()->setMimeData(fullTextMimeData()); }
};
