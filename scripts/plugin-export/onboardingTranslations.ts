/**
 * The onboarding prompts in agent.yaml are written in Turkish for the desktop app's
 * own onboarding UI. Skills read in Claude Code/Cowork need the same intent in English,
 * kept short. Fixed per onboarding question id rather than machine-translated, so the
 * meaning stays exact.
 */
export const onboardingTranslations: Record<string, string> = {
  'choose-accountant-company': "Which company's books are we keeping? Give the company name, Companies House number, "
    + 'accounting year end (e.g. 31 March), and VAT quarter stagger if VAT-registered.',
  'choose-accountant-sources': 'Where are the accounting records? Point to the folder or files with Xero or bank CSV '
    + "exports. Say no if there isn't one yet.",
  'choose-blog-topic': 'What should the first post be about? Describe the topic in your own words, and add the '
    + 'intended audience or an idea to emphasize if you have one.',
  'choose-writing-sources': 'Which sources should shape your writing voice and existing content? Article links, a '
    + 'profile URL, or a file location.',
  'choose-blog-publish-target': 'Which site or project should be used when you ask for a post to be published?',
  'choose-blog-social-account': 'Which LinkedIn account should a post be shared to once it is published? Public '
    + 'profile URL only.',
  'choose-career-sources': 'Which sources should be used for your CV and career profile? A GitHub or LinkedIn URL, a '
    + 'CV file, or several sources.',
  'choose-additional-career-sources': 'Any other source or information to add, such as another profile or CV file? '
    + "Say no if this is enough for now.",
  'choose-career-publish-target': 'Where should the review result be published? Keep it here, or point to a file or '
    + 'a site/project target.',
  'choose-career-social-account': 'Which LinkedIn account should this be shared on? Public profile URL only.',
};
