"""Same-dataset local report for the four original daily strategy families."""
from datetime import datetime, timezone
import json
import re

FAMILIES = ['moving-average-crossover', 'macd-crossover', 'rsi-rebound', 'volume-breakout']

def build_watchlist_review(report, manifest, selection):
    group, coverage = selection['group'], manifest['coverage']
    candidates = report['candidates']
    lines = [
        f"{group['name']}量化研究已完成：请求 {coverage['requested']} 只，成功 {coverage['succeeded']} 只，失败 {coverage['failed']} 只；数据截至 {manifest['asOf']}，清单标注为前复权。",
        '四类策略结果：' + '；'.join(f"{item['label']}（稳定参数 {item['stableParameterCount']}，当前候选 {item['candidateCount']}）" for item in report['comparisons']) + '。',
        ('本次研究候选 ' + str(len(candidates)) + ' 只：' + '、'.join(item['code']+' '+item['name'] for item in candidates[:10]) + '。') if candidates else '本次没有满足当前样本外门槛和收盘信号的研究候选。',
        '数据来源：' + json.dumps(manifest.get('source'), ensure_ascii=False) + '。本次仅使用已有本地数据，未在线采集。',
        '限制：使用当前分组成分，仍有幸存者偏差；数据真实性和使用条款未独立验证；结果不自动下单。',
    ]
    if selection['failures']:
        lines.append('失败项：' + '；'.join(item.get('code','')+' '+re.split(r'\s+for url:',str(item.get('reason') or '未知原因'),flags=re.I)[0][:120] for item in selection['failures']) + '。完整错误保留在原始清单。')
    summary = '\n'.join(lines)
    packet = dict(group=group, data={key: manifest.get(key) for key in ('datasetId','asOf','adjustmentMode','eligibility','coverage','warnings','source')},
                  strategies=report['comparisons'], candidates=candidates, reportWarnings=report['warnings'], automaticTrading=False)
    prompt = '请只依据以下 WebStock 结构化量化证据进行分析。先评价数据可信度，再逐策略说明样本外证据，然后给出候选观察顺序、反证、缺失信息和人工核验步骤；不要补造行情、胜率或收益承诺。\n\n' + summary + '\n\n结构化证据：\n' + json.dumps(packet,ensure_ascii=False,indent=2)
    shortlist = candidates[:20]
    preview = dict(status='ready' if candidates else 'blocked', automaticApply=False,
                   reason='仅供候选预览；本机研究不写入同花顺。' if candidates else '本次没有合格候选，禁止写入空荐股分组。',
                   date=report['asOf'], groupName='00_每日荐股_'+report['asOf'][5:7]+report['asOf'][8:10], totalCandidateCount=len(candidates),
                   truncated=len(shortlist)<len(candidates), items=[dict(code=item['code'],name=item['name'],tier='多策略稳定' if item['stableFamilyCount']>1 else '单策略稳定' if item['stableFamilyCount'] else '继续观察') for item in shortlist])
    return dict(localSummary=summary,handoffPrompt=prompt,recommendationPreview=preview)

def build_report(results):
    by_family = {result['ruleCard']['strategyFamily']: result for result in results}
    if set(by_family) != set(FAMILIES) or len(results) != 4:
        raise ValueError('A complete daily report requires all four original families')
    selected = [by_family[family] for family in FAMILIES]
    first = selected[0]
    identity = (first['dataManifest']['datasetId'], first['dataManifest']['sha256'], first['asOf'])
    for result in selected:
        if result.get('automaticTrading') is not False or (result['dataManifest']['datasetId'], result['dataManifest']['sha256'], result['asOf']) != identity:
            raise ValueError('Strategy comparison mixes datasets, dates, or trading authority')
    comparisons, by_code = [], {}
    for result in selected:
        card, current = result['ruleCard'], result.get('currentSignals') or {}
        family, label = card['strategyFamily'], card.get('label') or card['strategyFamily']
        best = result.get('bestParameter') or {}
        comparisons.append(dict(strategyFamily=family, label=label, runId=result['runId'],
                                bestParameterId=best.get('parameterId', ''), bestParameterLabel=best.get('label', ''),
                                stableParameterCount=len(result.get('stableParameterIds', [])),
                                selectedWalkForward=result.get('selectedWalkForward'),
                                candidateCount=current.get('candidateCount', 0), universeScanned=current.get('universeScanned', 0),
                                verification=None))
        for candidate in current.get('candidates', []):
            code = str(candidate.get('code', ''))
            if not re.fullmatch(r'\d{6}', code):
                continue
            combined = by_code.setdefault(code, dict(code=code, name=candidate.get('name') or code,
                                                    signalDate=result['asOf'], earliestObservation='next-executable-open', families=[]))
            combined['families'].append(dict(strategyFamily=family, label=label, runId=result['runId'],
                                             candidateStatus=candidate.get('candidateStatus'),
                                             parameterIds=candidate.get('parameterIds', []), evidence=candidate.get('evidence', [])))
    candidates = list(by_code.values())
    for candidate in candidates:
        candidate['stableFamilyCount'] = sum(family['candidateStatus'] == 'stable' for family in candidate['families'])
        candidate['watchFamilyCount'] = sum(family['candidateStatus'] == 'watch' for family in candidate['families'])
        candidate['consensusCount'] = len(candidate['families'])
        candidate['maxPositiveFoldRate'] = max([0] + [float(item.get('positiveFoldRate') or 0) for family in candidate['families'] for item in family['evidence']])
    candidates.sort(key=lambda item: (-item['stableFamilyCount'], -item['consensusCount'], -item['watchFamilyCount'], -item['maxPositiveFoldRate'], item['code']))
    warnings = ['候选只表示收盘信号，最早于下一可成交交易日开盘人工观察。']
    if len(candidates) > 200:
        warnings.insert(0, '候选数量超过页面上限，已截断。')
    return dict(schema='webstock.quant.strategy-daily.v1', status='complete', automaticTrading=False,
                datasetId=identity[0], manifestSha256=identity[1], asOf=identity[2],
                createdAt=datetime.now(timezone.utc).isoformat(), comparisons=comparisons, missingFamilies=[],
                candidateCount=len(candidates), storedCount=min(len(candidates), 200), truncated=len(candidates)>200,
                candidates=candidates[:200], warnings=warnings)
