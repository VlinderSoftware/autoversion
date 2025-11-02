Feature: Autoversion Tag Management
  As a developer
  I want the autoversion action to manage version tags correctly
  So that I can maintain proper semantic versioning for my releases

  Background:
    Given I am on a release branch

  Scenario: Tag already exists for package.json version
    Given package.json has version "1.2.3"
    And tag "v1.2.3" already exists
    When I run the autoversion action
    Then the action should fail
    And the error should mention that tag "v1.2.3" already exists

  Scenario: Package.json version mismatches release branch major version
    Given I am on release branch "release/v1"
    And package.json has version "0.2.0"
    When I run the autoversion action with version-source "package.json"
    Then the action should fail
    And the error should mention version mismatch between branch and package.json

  Scenario: Package.json version mismatches release branch minor version
    Given I am on release branch "release/v2.1"
    And package.json has version "2.0.0"
    When I run the autoversion action with version-source "package.json"
    Then the action should fail
    And the error should mention version mismatch between branch and package.json

  Scenario: Package.json version mismatches release branch - different major
    Given I am on release branch "release/v1"
    And package.json has version "2.0.0"
    When I run the autoversion action with version-source "package.json"
    Then the action should fail
    And the error should mention version mismatch between branch and package.json

  Scenario: Package.json with different minor version but branch has no minor - should succeed
    Given I am on release branch "release/v1"
    And package.json has version "1.1.0"
    When I run the autoversion action with version-source "package.json"
    Then the action should succeed
    And tags "v1", "v1.1", and "v1.1.0" should be created
    And all tags should point to the current commit

  Scenario: Successful first release from branch name
    Given I am on release branch "release/v1"
    And no tags exist
    When I run the autoversion action
    Then tags "v1", "v1.0", and "v1.0.0" should be created
    And all tags should point to the current commit

  Scenario: Successful subsequent release from branch name
    Given I am on release branch "release/v1"
    And tags "v1", "v1.0", "v1.0.0" already exist
    When I run the autoversion action
    Then tags "v1" and "v1.0" should be updated to current commit
    And tag "v1.0.1" should be created pointing to current commit

  Scenario: Successful release from package.json with patch 0
    Given I am on release branch "release/v2"
    And package.json has version "2.5.0"
    And no tags exist for "v2.5.*"
    When I run the autoversion action
    Then tags "v2", "v2.5", and "v2.5.0" should be created
    And all tags should point to the current commit

  Scenario: Successful release from package.json with non-zero patch
    Given I am on release branch "release/v1"
    And package.json has version "1.3.7"
    And no tags exist
    When I run the autoversion action
    Then tags "v1", "v1.3", and "v1.3.7" should be created
    And all tags should point to the current commit

  Scenario: Version-only mode does not create tags
    Given I am on release branch "release/v1"
    And package.json has version "1.0.0"
    When I run the autoversion action with create-tags "false"
    Then no tags should be created
    And the version output should be "1.0.0"

  Scenario: Auto mode uses package.json when available
    Given I am on release branch "release/v1"
    And package.json has version "1.2.0"
    When I run the autoversion action with version-source "auto"
    Then the version should be determined from package.json
    And tags "v1", "v1.2", and "v1.2.0" should be created

  Scenario: Auto mode falls back to branch name when package.json unavailable
    Given I am on release branch "release/v2.1"
    And package.json does not exist
    When I run the autoversion action with version-source "auto"
    Then the version should be determined from branch name
    And tags "v2", "v2.1", and "v2.1.0" should be created
