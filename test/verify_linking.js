function extractReferencedSessionId(content, currentSessionId) {
    if (!content) return undefined;
    let clean = content
      .replace(/<conversation_summaries>[\s\S]*?<\/conversation_summaries>/gi, '')
      .replace(/#\s*Conversation History[\s\S]*?(?=<USER_REQUEST>|$)/gi, '')
      .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, '')
      .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, '')
      .replace(/<system_instructions>[\s\S]*?<\/system_instructions>/gi, '')
      .replace(/<conversation_transcript>[\s\S]*?<\/conversation_transcript>/gi, '')
      .replace(/<knowledge_items>[\s\S]*?<\/knowledge_items>/gi, '')
      .replace(/<customizations>[\s\S]*?<\/customizations>/gi, '')
      .replace(/<artifacts>[\s\S]*?<\/artifacts>/gi, '')
      .replace(/<planning_mode>[\s\S]*?<\/planning_mode>/gi, '')
      .replace(/<identity>[\s\S]*?<\/identity>/gi, '')
      .replace(/<slash_commands>[\s\S]*?<\/slash_commands>/gi, '')
      .replace(/<web_application_development>[\s\S]*?<\/web_application_development>/gi, '')
      .replace(/<user_rules>[\s\S]*?<\/user_rules>/gi, '')
      .replace(/<user_information>[\s\S]*?<\/user_information>/gi, '');

    const userReqMatch = clean.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
    const targetText = userReqMatch ? userReqMatch[1] : clean;
    if (!targetText || !targetText.trim()) return undefined;

    const sessionExplicitMatch = targetText.match(/(?:Session ID|SessionId|Conversation ID|Session):\s*[`"']?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[`"']?/i);
    if (sessionExplicitMatch) {
      const candidate = sessionExplicitMatch[1].toLowerCase();
      if (candidate !== currentSessionId.toLowerCase()) return candidate;
    }
    const resumeMatch = targetText.match(/(?:resume|continu(?:e|ing)|tiếp tục|phiên trước|previous session|parent session)[\s\S]{0,80}?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (resumeMatch) {
      const candidate = resumeMatch[1].toLowerCase();
      if (candidate !== currentSessionId.toLowerCase()) return candidate;
    }
    const tagMatch = targetText.match(/@(?:session|conversation|chat)[:=]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (tagMatch) {
      const candidate = tagMatch[1].toLowerCase();
      if (candidate !== currentSessionId.toLowerCase()) return candidate;
    }
    return undefined;
}

// Case 1: Unrelated session with conversation_summaries injected
const test1 = '# Conversation History\n<conversation_summaries>\n## Conversation fdc84a4b-3499-4b00-a5ee-c3ff3e3bc8ff: Phaser Tile Maps\n</conversation_summaries>\n<USER_REQUEST>\nFix current problems\n</USER_REQUEST>';
const res1 = extractReferencedSessionId(test1, '326f1a25-bfd8-439d-b77f-676d5fe34d9f');
console.log('Test 1 (System summary only):', res1 === undefined ? 'PASSED (not linked)' : 'FAILED: ' + res1);

// Case 2: Intentional Resume Prompt
const test2 = '<USER_REQUEST>\nHãy đọc lại ngữ cảnh hội thoại trước đó của phiên làm việc tại thư mục:\n`d:/project`\n(Session ID: `fdc84a4b-3499-4b00-a5ee-c3ff3e3bc8ff` - Chủ đề: "Test")\nvà tiếp tục hỗ trợ tôi.\n</USER_REQUEST>';
const res2 = extractReferencedSessionId(test2, '326f1a25-bfd8-439d-b77f-676d5fe34d9f');
console.log('Test 2 (Explicit Resume Prompt):', res2 === 'fdc84a4b-3499-4b00-a5ee-c3ff3e3bc8ff' ? 'PASSED' : 'FAILED: ' + res2);

// Case 3: @session tag
const test3 = '<USER_REQUEST>\nContinue from @session:fdc84a4b-3499-4b00-a5ee-c3ff3e3bc8ff please\n</USER_REQUEST>';
const res3 = extractReferencedSessionId(test3, '326f1a25-bfd8-439d-b77f-676d5fe34d9f');
console.log('Test 3 (@session tag):', res3 === 'fdc84a4b-3499-4b00-a5ee-c3ff3e3bc8ff' ? 'PASSED' : 'FAILED: ' + res3);

if (res1 === undefined && res2 === 'fdc84a4b-3499-4b00-a5ee-c3ff3e3bc8ff' && res3 === 'fdc84a4b-3499-4b00-a5ee-c3ff3e3bc8ff') {
    console.log('ALL TESTS PASSED SUCCESSFULLY!');
} else {
    process.exit(1);
}
