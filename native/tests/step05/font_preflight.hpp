#pragma once
#include <QtWidgets>
#include <QRawFont>
#include <QTextLayout>
#include "fixtures.hpp"

namespace fontCheck {
inline QJsonObject load(){
 const auto path=qEnvironmentVariable("D05_FONT_PINS");fixture::need(!path.isEmpty(),"font pins path missing");QJsonParseError error;const auto doc=QJsonDocument::fromJson(fixture::read(path),&error);fixture::need(error.error==QJsonParseError::NoError&&doc.isObject(),"font pins JSON invalid");return doc.object();
}
inline QJsonObject tables(const QRawFont& raw,const QJsonObject& pins){
 QJsonObject result;const auto expected=pins["uiFace"].toObject()["tablePins"].toObject();bool same=true;
 for(auto it=expected.begin();it!=expected.end();++it){const auto tag=it.key().toLatin1();const auto bytes=raw.fontTable(tag.constData());const auto hash=fixture::hash(bytes);const bool match=hash==it.value().toObject()["sha256"].toString()&&bytes.size()==it.value().toObject()["bytes"].toInt();result[it.key()]=QJsonObject{{"bytes",bytes.size()},{"sha256",hash},{"matchesPinnedFace",match}};same&=match;}
 result["allSixTablesMatch"]=same;return result;
}
inline void describe(const QFont& font,const QJsonObject& pins,QJsonObject& proof){
 const QFontInfo info(font);const auto raw=QRawFont::fromFont(font);proof["requestedFamily"]=font.family();proof["actualFamily"]=info.family();proof["actualStyle"]=info.styleName();proof["actualPointSize"]=info.pointSizeF();proof["pixelSize"]=info.pixelSize();proof["rawFamily"]=raw.familyName();proof["rawStyle"]=raw.styleName();proof["fontMetricsHeight"]=QFontMetrics(font).height();
 fixture::need(raw.isValid(),"QRawFont invalid");const auto tableProof=tables(raw,pins);proof["tables"]=tableProof;
 QJsonArray characters;bool glyphs=true;for(auto value:pins["uiFace"].toObject()["representativeGlyphs"].toArray()){
  const auto expected=value.toObject();const auto text=expected["character"].toString();const auto indexes=raw.glyphIndexesForString(text);const auto glyph=indexes.size()==1?indexes[0]:0;const bool support=raw.supportsCharacter(uint(expected["codepoint"].toInt()));const bool same=support&&glyph>0&&glyph==uint(expected["glyph"].toInt());characters.append(QJsonObject{{"character",text},{"codepoint",expected["codepoint"]},{"expectedGlyph",expected["glyph"]},{"actualGlyph",int(glyph)},{"supportsCharacter",support},{"matchesPinnedCmap",same}});glyphs&=same;
 }proof["representativeGlyphs"]=characters;proof["all22RepresentativeGlyphsMatch"]=glyphs;
 QTextLayout layout(pins["representative"].toString(),font);layout.beginLayout();auto line=layout.createLine();fixture::need(line.isValid(),"representative text layout unavailable");line.setLineWidth(10000);layout.endLayout();QJsonArray runs;bool runsValid=true;const auto actualRuns=layout.glyphRuns();
 for(const auto& run:actualRuns){const auto runFont=run.rawFont();QJsonArray ids;bool nonzero=!run.glyphIndexes().isEmpty();for(auto id:run.glyphIndexes()){ids.append(int(id));nonzero&=id!=0;}const auto runTables=tables(runFont,pins);const bool same=runFont.familyName()==pins["requiredFamily"].toString()&&runTables["allSixTablesMatch"].toBool()&&nonzero;runs.append(QJsonObject{{"family",runFont.familyName()},{"style",runFont.styleName()},{"glyphIndexes",ids},{"nonzero",nonzero},{"tablesMatchPinnedUiFace",runTables["allSixTablesMatch"]},{"usesRequiredFace",same}});runsValid&=same;}
 proof["shapedGlyphRuns"]=runs;proof["allShapedRunsUsePinnedUiFace"]=runsValid&&!actualRuns.isEmpty();
 fixture::need(info.family()==pins["requiredFamily"].toString()&&raw.familyName()==pins["requiredFamily"].toString(),"requested UI family silently substituted");fixture::need(tableProof["allSixTablesMatch"].toBool(),"actual font tables differ from installed UI face");fixture::need(glyphs,"representative Chinese/digit glyph does not match installed UI cmap");fixture::need(runsValid&&!actualRuns.isEmpty(),"representative text uses fallback or missing glyph");
}
inline void prepare(QApplication& app,const QJsonObject& pins,QJsonObject& proof){
 proof={{"schema","r05-font10-preflight/v1"},{"status","STARTED"},{"fontFile",pins["fontFile"]},{"requiredFamily",pins["requiredFamily"]},{"registeredFontName",pins["registryValueName"]},{"systemFontChanged",false},{"applicationFontRegistrationOnly",true}};
 const auto bytes=fixture::read(pins["fontFile"].toString());const auto actual=fixture::hash(bytes);proof["fontFileBytes"]=bytes.size();proof["fontFileSha256"]=actual;fixture::need(actual==pins["fontSha256"].toString()&&bytes.size()==pins["fontBytes"].toInt(),"installed font file differs from pinned registered file");
 const int id=QFontDatabase::addApplicationFont(pins["fontFile"].toString());proof["applicationFontId"]=id;proof["loadedFamilies"]=QJsonArray::fromStringList(QFontDatabase::applicationFontFamilies(id));fixture::need(id>=0&&QFontDatabase::applicationFontFamilies(id).contains(pins["requiredFamily"].toString()),"Qt cannot register the installed UI font family");
 QFont selected(pins["requiredFamily"].toString(),pins["pointSize"].toInt());selected.setWeight(QFont::Normal);selected.setStyleStrategy(QFont::NoFontMerging);app.setFont(selected);QJsonObject identity;try{describe(app.font(),pins,identity);}catch(...){proof["actualFont"]=identity;throw;}proof["actualFont"]=identity;
 const QFont legacy("Agency FB",10);const QFontInfo info(legacy);proof["legacyFamilyMetricsOnly"]=QJsonObject{{"requestedFamily","Agency FB"},{"actualFamily",info.family()},{"fontHeight",QFontMetrics(legacy).height()},{"fontAscent",QFontMetrics(legacy).ascent()},{"fontDescent",QFontMetrics(legacy).descent()},{"notAnOldFontPaintOrTimingRun",true}};proof["status"]="READY_PINNED_MICROSOFT_YAHEI_UI";
}
inline QJsonObject geometry(QWidget* widget,QWidget* page){const auto p=widget->mapTo(page,QPoint());return {{"x",p.x()},{"y",p.y()},{"w",widget->width()},{"h",widget->height()},{"fontHeight",widget->fontMetrics().height()},{"minimumHeight",widget->minimumHeight()},{"maximumHeight",widget->maximumHeight()}};}
}
